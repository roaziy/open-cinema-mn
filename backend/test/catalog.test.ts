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
import { BranchShowtimesSchema, MovieSummarySchema, SeatMapSchema } from '../src/shared';
import { fixedClock, makeTestApp, one, resetDb } from './helpers';

// 12:00 in Ulaanbaatar on 2026-11-08
const NOW = '2026-11-08T04:00:00Z';
const clock = fixedClock(NOW);

async function fixture() {
  const [b1] = await db
    .insert(branches)
    .values({ name: 'Zuun', address: 'A', lat: 1, lng: 2 })
    .returning();
  const [b2] = await db
    .insert(branches)
    .values({ name: 'Arvin', address: 'B', lat: 3, lng: 4 })
    .returning();
  const [h1] = await db
    .insert(halls)
    .values({
      branchId: one(b1).id,
      name: 'Hall 1',
      screenWidthM: 10,
      screenHeightM: 5,
      screenXM: 5,
    })
    .returning();
  const [h2] = await db
    .insert(halls)
    .values({
      branchId: one(b2).id,
      name: 'Hall 2',
      screenWidthM: 10,
      screenHeightM: 5,
      screenXM: 5,
    })
    .returning();
  const seatRows = await db
    .insert(seats)
    .values([
      { hallId: one(h1).id, rowLabel: 'A', number: 1, xM: 1, yM: 1 },
      { hallId: one(h1).id, rowLabel: 'A', number: 2, xM: 2, yM: 1 },
      { hallId: one(h1).id, rowLabel: 'A', number: 3, xM: 3, yM: 1 },
      { hallId: one(h1).id, rowLabel: 'A', number: 4, xM: 4, yM: 1, kind: 'blocked' },
      { hallId: one(h2).id, rowLabel: 'A', number: 1, xM: 1, yM: 1 },
    ])
    .returning();
  const base = {
    synopsis: 's',
    durationMin: 100,
    ageRating: '12+',
    posterUrl: 'http://x/p.png',
  };
  const [now1] = await db
    .insert(movies)
    .values({ ...base, title: 'Old', status: 'now', releaseDate: '2026-10-01' })
    .returning();
  const [now2] = await db
    .insert(movies)
    .values({ ...base, title: 'Newer', status: 'now', releaseDate: '2026-11-01' })
    .returning();
  await db
    .insert(movies)
    .values({ ...base, title: 'Later', status: 'soon', releaseDate: '2026-12-20' });
  await db
    .insert(movies)
    .values({ ...base, title: 'Sooner', status: 'soon', releaseDate: '2026-11-20' });
  await db
    .insert(movies)
    .values({ ...base, title: 'Gone', status: 'archived', releaseDate: '2020-01-01' });
  const mk = (hallId: string, startsAt: string, over = {}) => ({
    movieId: one(now2).id,
    hallId,
    startsAt: new Date(startsAt),
    priceStandard: 15000,
    pricePremium: 22000,
    ...over,
  });
  const inserted = await db
    .insert(showtimes)
    .values([
      mk(one(h1).id, '2026-11-08T11:00:00Z'), // 19:00 UB Nov 8
      mk(one(h1).id, '2026-11-08T08:00:00Z'), // 16:00 UB Nov 8
      mk(one(h1).id, '2026-11-08T02:00:00Z'), // 10:00 UB, already started
      mk(one(h2).id, '2026-11-08T12:00:00Z'), // 20:00 UB Nov 8
      mk(one(h1).id, '2026-11-08T17:00:00Z'), // 01:00 UB Nov 9
      mk(one(h1).id, '2026-11-08T16:30:00Z'), // 00:30 UB Nov 9
      mk(one(h1).id, '2026-11-08T13:00:00Z', { status: 'cancelled' }),
    ])
    .returning();
  return {
    b1: one(b1),
    b2: one(b2),
    h1: one(h1),
    seatRows,
    now1: one(now1),
    now2: one(now2),
    st: inserted,
  };
}

beforeEach(resetDb);

describe('catalog', () => {
  it('lists branches by name', async () => {
    await fixture();
    const res = await request(makeTestApp({ clock })).get('/v1/branches').expect(200);
    expect(res.body.map((b: { name: string }) => b.name)).toEqual(['Arvin', 'Zuun']);
  });

  it('lists movies by status in release order and hides archived', async () => {
    await fixture();
    const app = makeTestApp({ clock });
    const now = await request(app).get('/v1/movies?status=now').expect(200);
    expect(now.body.map((m: { title: string }) => m.title)).toEqual(['Newer', 'Old']);
    for (const m of now.body) MovieSummarySchema.parse(m);
    const soon = await request(app).get('/v1/movies?status=soon').expect(200);
    expect(soon.body.map((m: { title: string }) => m.title)).toEqual(['Sooner', 'Later']);
    await request(app).get('/v1/movies?status=bogus').expect(400);
  });

  it('returns movie detail and 404 for unknown or malformed ids', async () => {
    const f = await fixture();
    const app = makeTestApp({ clock });
    const res = await request(app).get(`/v1/movies/${f.now2.id}`).expect(200);
    expect(res.body).toMatchObject({ title: 'Newer', synopsis: 's', trailerUrl: null });
    await request(app).get('/v1/movies/not-a-uuid').expect(404);
    await request(app).get('/v1/movies/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('groups upcoming scheduled showtimes by branch for a UB date', async () => {
    const f = await fixture();
    const app = makeTestApp({ clock });
    const res = await request(app)
      .get(`/v1/movies/${f.now2.id}/showtimes?date=2026-11-08`)
      .expect(200);
    const groups = BranchShowtimesSchema.array().parse(res.body);
    expect(groups.map((g) => g.branch.name)).toEqual(['Arvin', 'Zuun']);
    expect(groups[1]?.showtimes.map((s) => s.startsAt)).toEqual([
      '2026-11-08T08:00:00.000Z',
      '2026-11-08T11:00:00.000Z',
    ]);
    expect(groups[0]?.showtimes).toHaveLength(1);
  });

  it('puts a 00:30 UB show on its UB date, not the previous UTC day', async () => {
    const f = await fixture();
    const app = makeTestApp({ clock });
    const nov9 = await request(app)
      .get(`/v1/movies/${f.now2.id}/showtimes?date=2026-11-09`)
      .expect(200);
    expect(nov9.body).toHaveLength(1);
    expect(nov9.body[0].showtimes.map((s: { startsAt: string }) => s.startsAt)).toEqual([
      '2026-11-08T16:30:00.000Z',
      '2026-11-08T17:00:00.000Z',
    ]);
    const nov8 = await request(app)
      .get(`/v1/movies/${f.now2.id}/showtimes?date=2026-11-08`)
      .expect(200);
    const all = nov8.body.flatMap((g: { showtimes: { startsAt: string }[] }) => g.showtimes);
    expect(all.map((s: { startsAt: string }) => s.startsAt)).not.toContain(
      '2026-11-08T16:30:00.000Z',
    );
  });

  it('defaults to today in UB and excludes shows that already started', async () => {
    const f = await fixture();
    const res = await request(makeTestApp({ clock }))
      .get(`/v1/movies/${f.now2.id}/showtimes`)
      .expect(200);
    const starts = res.body.flatMap((g: { showtimes: { startsAt: string }[] }) =>
      g.showtimes.map((s) => s.startsAt),
    );
    expect(starts).not.toContain('2026-11-08T02:00:00.000Z');
    expect(starts).toHaveLength(3);
  });

  it('computes seatsLeft from capacity minus sold and live holds', async () => {
    const f = await fixture();
    const [user] = await db
      .insert(users)
      .values({ role: 'customer', phone: '+97699112045' })
      .returning();
    const show = one(f.st.find((s) => s.startsAt.toISOString() === '2026-11-08T08:00:00.000Z'));
    const [booking] = await db
      .insert(bookings)
      .values({
        userId: one(user).id,
        showtimeId: show.id,
        total: 15000,
        idempotencyKey: crypto.randomUUID(),
      })
      .returning();
    const [s1, s2, s3] = f.seatRows;
    await db.insert(tickets).values({
      bookingId: one(booking).id,
      showtimeId: show.id,
      seatId: one(s1).id,
      qrToken: 't',
    });
    await db.insert(seatHolds).values([
      {
        showtimeId: show.id,
        seatId: one(s2).id,
        userId: one(user).id,
        expiresAt: new Date('2026-11-08T04:10:00Z'),
      },
      {
        showtimeId: show.id,
        seatId: one(s3).id,
        userId: one(user).id,
        expiresAt: new Date('2026-11-08T03:59:00Z'),
      },
    ]);
    const res = await request(makeTestApp({ clock }))
      .get(`/v1/movies/${f.now2.id}/showtimes?date=2026-11-08`)
      .expect(200);
    const slot = res.body
      .flatMap(
        (g: { showtimes: { id: string; seatsLeft: number; capacity: number }[] }) => g.showtimes,
      )
      .find((s: { id: string }) => s.id === show.id);
    // 3 non-blocked seats: 1 sold, 1 live hold, 1 expired hold counts as free
    expect(slot).toMatchObject({ capacity: 3, seatsLeft: 1 });
  });

  it('serves a seat map with per-seat state', async () => {
    const f = await fixture();
    const [user] = await db
      .insert(users)
      .values({ role: 'customer', phone: '+97699112045' })
      .returning();
    const show = one(f.st[1]);
    const [s1, s2] = f.seatRows;
    await db.insert(seatHolds).values({
      showtimeId: show.id,
      seatId: one(s1).id,
      userId: one(user).id,
      expiresAt: new Date('2026-11-08T04:10:00Z'),
    });
    const [booking] = await db
      .insert(bookings)
      .values({
        userId: one(user).id,
        showtimeId: show.id,
        total: 1,
        idempotencyKey: crypto.randomUUID(),
      })
      .returning();
    await db.insert(tickets).values({
      bookingId: one(booking).id,
      showtimeId: show.id,
      seatId: one(s2).id,
      qrToken: 't',
    });
    const res = await request(makeTestApp({ clock })).get(`/v1/showtimes/${show.id}`).expect(200);
    const map = SeatMapSchema.parse(res.body);
    expect(map.showtime.movie.title).toBe('Newer');
    expect(map.hall.name).toBe('Hall 1');
    expect(map.seats.map((s) => [s.number, s.state])).toEqual([
      [1, 'held'],
      [2, 'sold'],
      [3, 'free'],
      [4, 'free'],
    ]);
    await request(makeTestApp({ clock })).get('/v1/showtimes/nope').expect(404);
  });
});
