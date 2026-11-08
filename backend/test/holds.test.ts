import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import {
  bookings,
  branches,
  halls,
  movies,
  seatHolds,
  seats,
  showtimes,
  tickets,
  users,
} from '../src/db/schema';
import { SeatHub } from '../src/lib/seat-hub';
import { signAccessToken } from '../src/lib/tokens';
import { fixedClock, makeTestApp, one, resetDb } from './helpers';

const clock = fixedClock('2026-11-08T04:00:00Z');
const MIN = 60_000;

async function fixture() {
  const b = one(
    (await db.insert(branches).values({ name: 'B', address: 'a', lat: 0, lng: 0 }).returning())[0],
  );
  const hall = (name: string) =>
    db
      .insert(halls)
      .values({ branchId: b.id, name, screenWidthM: 10, screenHeightM: 5, screenXM: 5 })
      .returning()
      .then((r) => one(r[0]));
  const h = await hall('H1');
  const other = await hall('H2');
  const mk = (hallId: string, n: number, kind: 'standard' | 'blocked' = 'standard') => ({
    hallId,
    rowLabel: 'A',
    number: n,
    xM: n,
    yM: 1,
    kind,
  });
  const rows = await db
    .insert(seats)
    .values([...Array.from({ length: 12 }, (_, i) => mk(h.id, i + 1)), mk(h.id, 13, 'blocked')])
    .returning();
  rows.sort((a, c) => a.number - c.number);
  const foreign = one((await db.insert(seats).values(mk(other.id, 1)).returning())[0]);
  const m = one(
    (
      await db
        .insert(movies)
        .values({
          title: 'M',
          durationMin: 90,
          ageRating: '12+',
          posterUrl: 'p',
          status: 'now',
          releaseDate: '2026-11-01',
        })
        .returning()
    )[0],
  );
  const show = one(
    (
      await db
        .insert(showtimes)
        .values({
          movieId: m.id,
          hallId: h.id,
          startsAt: new Date('2026-11-08T11:00:00Z'),
          priceStandard: 1,
          pricePremium: 2,
        })
        .returning()
    )[0],
  );
  const user = async (phone: string) => {
    const u = one((await db.insert(users).values({ role: 'customer', phone }).returning())[0]);
    return { id: u.id, auth: `Bearer ${await signAccessToken(u, clock())}` };
  };
  const seatId = (n: number) => one(rows.find((s) => s.number === n)).id;
  return {
    show,
    seatId,
    foreign,
    user,
    alice: await user('+97699000001'),
    bob: await user('+97699000002'),
  };
}

const post = (
  app: ReturnType<typeof makeTestApp>,
  showId: string,
  auth: string,
  seatIds: string[],
) =>
  request(app).post(`/v1/showtimes/${showId}/holds`).set('Authorization', auth).send({ seatIds });

beforeEach(async () => {
  await resetDb();
});

describe('seat holds', () => {
  it('holds seats for 10 minutes and publishes held', async () => {
    const f = await fixture();
    const hub = new SeatHub();
    const seen: unknown[] = [];
    hub.subscribe(f.show.id, (c) => seen.push(c));
    const app = makeTestApp({ clock, seatHub: hub });
    const res = await post(app, f.show.id, f.alice.auth, [f.seatId(1), f.seatId(2)]).expect(200);
    expect(res.body.holds).toHaveLength(2);
    expect(res.body.holds[0].expiresAt).toBe('2026-11-08T04:10:00.000Z');
    expect(seen).toEqual([
      [
        { seatId: f.seatId(1), state: 'held' },
        { seatId: f.seatId(2), state: 'held' },
      ],
    ]);
    const mine = await request(app)
      .get(`/v1/showtimes/${f.show.id}/holds/mine`)
      .set('Authorization', f.alice.auth)
      .expect(200);
    expect(mine.body).toHaveLength(2);
  });

  it('requires auth', async () => {
    const f = await fixture();
    await request(makeTestApp({ clock }))
      .post(`/v1/showtimes/${f.show.id}/holds`)
      .send({ seatIds: [f.seatId(1)] })
      .expect(401);
  });

  it('lets exactly one of two parallel requests win a seat', async () => {
    const f = await fixture();
    const app = makeTestApp({ clock });
    for (let i = 1; i <= 5; i++) {
      const [a, b] = await Promise.all([
        post(app, f.show.id, f.alice.auth, [f.seatId(i)]),
        post(app, f.show.id, f.bob.auth, [f.seatId(i)]),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body).toEqual({ error: 'seat_taken', seatIds: [f.seatId(i)] });
    }
    expect(await db.select().from(seatHolds)).toHaveLength(5);
  });

  it('lets another user take a hold once it has expired', async () => {
    const f = await fixture();
    const c = fixedClock('2026-11-08T04:00:00Z');
    const app = makeTestApp({ clock: c });
    await post(app, f.show.id, f.alice.auth, [f.seatId(1)]).expect(200);
    await post(app, f.show.id, f.bob.auth, [f.seatId(1)]).expect(409);
    c.advance(10 * MIN);
    const res = await post(app, f.show.id, f.bob.auth, [f.seatId(1)]).expect(200);
    expect(res.body.holds[0].expiresAt).toBe('2026-11-08T04:20:00.000Z');
    const rows = await db.select().from(seatHolds);
    expect(rows).toHaveLength(1);
    expect(one(rows[0]).userId).toBe(f.bob.id);
  });

  it('rejects an 11th seat', async () => {
    const f = await fixture();
    const app = makeTestApp({ clock });
    const ten = Array.from({ length: 10 }, (_, i) => f.seatId(i + 1));
    await post(app, f.show.id, f.alice.auth, ten).expect(200);
    const res = await post(app, f.show.id, f.alice.auth, [f.seatId(11)]).expect(400);
    expect(res.body.error).toBe('too_many_seats');
    expect(await db.select().from(seatHolds)).toHaveLength(10);
  });

  it('counts across requests but ignores expired holds', async () => {
    const f = await fixture();
    const c = fixedClock('2026-11-08T04:00:00Z');
    const app = makeTestApp({ clock: c });
    await post(app, f.show.id, f.alice.auth, [1, 2, 3, 4, 5, 6].map(f.seatId)).expect(200);
    const res = await post(app, f.show.id, f.alice.auth, [7, 8, 9, 10, 11].map(f.seatId)).expect(
      400,
    );
    expect(res.body.error).toBe('too_many_seats');
    c.advance(11 * MIN);
    await post(app, f.show.id, f.alice.auth, [7, 8, 9, 10, 11].map(f.seatId)).expect(200);
  });

  it('returns an own active hold as-is with a refreshed expiry', async () => {
    const f = await fixture();
    const c = fixedClock('2026-11-08T04:00:00Z');
    const hub = new SeatHub();
    const seen: unknown[] = [];
    hub.subscribe(f.show.id, (x) => seen.push(x));
    const app = makeTestApp({ clock: c, seatHub: hub });
    const first = await post(app, f.show.id, f.alice.auth, [f.seatId(1)]).expect(200);
    c.advance(4 * MIN);
    const again = await post(app, f.show.id, f.alice.auth, [f.seatId(1), f.seatId(2)]).expect(200);
    const same = again.body.holds.find((h: { seatId: string }) => h.seatId === f.seatId(1));
    expect(same.id).toBe(first.body.holds[0].id);
    expect(same.expiresAt).toBe('2026-11-08T04:14:00.000Z');
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual([{ seatId: f.seatId(2), state: 'held' }]);
  });

  it('rejects a blocked seat and a seat with a valid ticket', async () => {
    const f = await fixture();
    const app = makeTestApp({ clock });
    const blocked = await post(app, f.show.id, f.alice.auth, [f.seatId(13)]).expect(409);
    expect(blocked.body).toEqual({ error: 'seat_taken', seatIds: [f.seatId(13)] });
    const booking = one(
      (
        await db
          .insert(bookings)
          .values({
            userId: f.bob.id,
            showtimeId: f.show.id,
            status: 'paid',
            total: 1,
            idempotencyKey: crypto.randomUUID(),
          })
          .returning()
      )[0],
    );
    await db.insert(tickets).values({
      bookingId: booking.id,
      showtimeId: f.show.id,
      seatId: f.seatId(1),
      qrToken: 'tok',
    });
    const sold = await post(app, f.show.id, f.alice.auth, [f.seatId(2), f.seatId(1)]).expect(409);
    expect(sold.body).toEqual({ error: 'seat_taken', seatIds: [f.seatId(1)] });
    expect(await db.select().from(seatHolds)).toHaveLength(0);
  });

  it('rejects seats from another hall and unknown or past showtimes', async () => {
    const f = await fixture();
    const app = makeTestApp({ clock });
    const res = await post(app, f.show.id, f.alice.auth, [f.seatId(1), f.foreign.id]).expect(400);
    expect(res.body.error).toBe('invalid_seat');
    await post(app, crypto.randomUUID(), f.alice.auth, [f.seatId(1)]).expect(404);
    const late = fixedClock('2026-11-08T11:00:00Z');
    const token = `Bearer ${await signAccessToken({ id: f.alice.id, role: 'customer' }, late())}`;
    const closed = await post(makeTestApp({ clock: late }), f.show.id, token, [f.seatId(1)]);
    expect(closed.status).toBe(400);
    expect(closed.body.error).toBe('showtime_closed');
  });

  it('rejects an empty seat list', async () => {
    const f = await fixture();
    const app = makeTestApp({ clock });
    await post(app, f.show.id, f.alice.auth, []).expect(400);
  });

  it('releases only the owner hold and publishes free', async () => {
    const f = await fixture();
    const hub = new SeatHub();
    const seen: unknown[] = [];
    const app = makeTestApp({ clock, seatHub: hub });
    const res = await post(app, f.show.id, f.alice.auth, [f.seatId(1)]).expect(200);
    const holdId = res.body.holds[0].id;
    hub.subscribe(f.show.id, (c) => seen.push(c));
    await request(app).delete(`/v1/holds/${holdId}`).set('Authorization', f.bob.auth).expect(404);
    expect(seen).toEqual([]);
    await request(app).delete(`/v1/holds/${holdId}`).set('Authorization', f.alice.auth).expect(204);
    expect(seen).toEqual([[{ seatId: f.seatId(1), state: 'free' }]]);
    await request(app).delete(`/v1/holds/${holdId}`).set('Authorization', f.alice.auth).expect(404);
    await post(app, f.show.id, f.bob.auth, [f.seatId(1)]).expect(200);
  });

  it('rate limits holds per user, not per address', async () => {
    const f = await fixture();
    const app = makeTestApp({ clock });
    for (let i = 0; i < 60; i++)
      await post(app, f.show.id, f.alice.auth, [f.seatId(1)]).expect(200);
    await post(app, f.show.id, f.alice.auth, [f.seatId(1)]).expect(429);
    await post(app, f.show.id, f.bob.auth, [f.seatId(2)]).expect(200);
  });
});
