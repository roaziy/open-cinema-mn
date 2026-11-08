import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/client';
import {
  bookings,
  branches,
  halls,
  movies,
  payments,
  seatHolds,
  seats,
  showtimes,
  tickets,
  users,
} from '../src/db/schema';
import { runSweep } from '../src/jobs/sweeper';
import { SeatHub } from '../src/lib/seat-hub';
import { signAccessToken } from '../src/lib/tokens';
import { MockPaymentProvider } from '../src/payments/mock';
import { confirmBooking, refundOwed } from '../src/services/bookings';
import { createHolds } from '../src/services/holds';
import { fakeMessages, fixedClock, makeTestApp, one, resetDb } from './helpers';

// 2026-11-08 10:00 UTC is 18:00 in Ulaanbaatar.
const NOW = '2026-11-08T10:00:00Z';
const MIN = 60_000;
const uuid = () => crypto.randomUUID();
const GEN = {
  rows: 2,
  seatsPerRow: 4,
  seatPitchM: 0.6,
  rowSpacingM: 1,
  aisleAfter: [2],
  firstRowDistanceM: 3,
  risePerRowM: 0.15,
};

function setup(makePayments?: (clock: () => Date) => MockPaymentProvider) {
  const clock = fixedClock(NOW);
  const messages = fakeMessages();
  const seatHub = new SeatHub();
  const mock = makePayments ? makePayments(clock) : new MockPaymentProvider(db, clock);
  const deps = { db, clock, messages, seatHub, payments: mock };
  const stored: string[] = [];
  const app = makeTestApp({
    ...deps,
    storage: {
      async put(key) {
        stored.push(key);
        return `http://files.test/${key}`;
      },
    },
  });
  return { clock, messages, seatHub, deps, app, stored };
}
type S = ReturnType<typeof setup>;

async function fixture() {
  const user = async (v: Partial<typeof users.$inferInsert>) =>
    one((await db.insert(users).values(v).returning())[0]);
  const branch = one(
    (
      await db
        .insert(branches)
        .values({ name: 'Central', address: 'a', lat: 47.9, lng: 106.9 })
        .returning()
    )[0],
  );
  const hall = one(
    (
      await db
        .insert(halls)
        .values({
          branchId: branch.id,
          name: 'Hall 1',
          screenWidthM: 10,
          screenHeightM: 5,
          screenXM: 0,
        })
        .returning()
    )[0],
  );
  const seatRows = await db
    .insert(seats)
    .values(
      Array.from({ length: 6 }, (_, i) => ({
        hallId: hall.id,
        rowLabel: 'F',
        number: i + 1,
        xM: i,
        yM: 1,
      })),
    )
    .returning();
  const movie = one(
    (
      await db
        .insert(movies)
        .values({
          title: 'Movie',
          durationMin: 100,
          ageRating: '12+',
          posterUrl: 'p.jpg',
          tone: '#112233',
          status: 'now',
          releaseDate: '2026-11-01',
        })
        .returning()
    )[0],
  );
  return {
    branch,
    hall,
    movie,
    seatId: (n: number) => one(seatRows.find((s) => s.number === n)).id,
    admin: await user({ role: 'admin', name: 'Admin', email: 'admin@x.mn' }),
    alice: await user({
      role: 'customer',
      phone: '+97699000001',
      email: 'alice@x.mn',
      emailVerifiedAt: new Date(NOW),
    }),
    bob: await user({ role: 'customer', phone: '+97699000002' }),
  };
}
type F = Awaited<ReturnType<typeof fixture>>;

const as = async (s: S, u: { id: string; role: 'staff' | 'admin' | 'customer' | 'guest' }) =>
  `Bearer ${await signAccessToken(u, s.clock())}`;

/** Admin-signed requests; the token is made once, so call it before moving the clock far. */
const api = async (s: S, f: F) => {
  const token = await as(s, f.admin);
  return (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string): request.Test =>
    request(s.app)[method](`/v1/admin${path}`).set('Authorization', token);
};

async function addShowtime(
  f: F,
  startsAt: string,
  over: Partial<typeof showtimes.$inferInsert> = {},
) {
  return one(
    (
      await db
        .insert(showtimes)
        .values({
          movieId: f.movie.id,
          hallId: f.hall.id,
          startsAt: new Date(startsAt),
          priceStandard: 10000,
          pricePremium: 15000,
          ...over,
        })
        .returning()
    )[0],
  );
}

/** Holds, books and mock-pays seats for `user`; returns the booking id. */
async function buy(s: S, f: F, showId: string, user: Parameters<typeof as>[1], ...nums: number[]) {
  const held = await createHolds(db, {
    showtimeId: showId,
    seatIds: nums.map(f.seatId),
    userId: user.id,
    now: s.clock(),
  });
  const auth = await as(s, user);
  const created = await request(s.app)
    .post('/v1/bookings')
    .set('Authorization', auth)
    .send({ holdIds: held.holds.map((x) => x.id), idempotencyKey: uuid() })
    .expect(200);
  await request(s.app)
    .post(`/v1/bookings/${created.body.id}/mock-pay`)
    .set('Authorization', auth)
    .expect(200);
  return created.body.id as string;
}

const paymentOf = async (bookingId: string) =>
  one((await db.select().from(payments).where(eq(payments.bookingId, bookingId)))[0]);
const bookingOf = async (id: string) =>
  one((await db.select().from(bookings).where(eq(bookings.id, id)))[0]);

beforeEach(async () => {
  await resetDb();
});

describe('admin access', () => {
  it('rejects anonymous callers with 401 and customers and staff with 403', async () => {
    const s = setup();
    const f = await fixture();
    const door = one(
      (
        await db
          .insert(users)
          .values({ role: 'staff', phone: '+97688000001', branchId: f.branch.id })
          .returning()
      )[0],
    );
    await request(s.app).get('/v1/admin/branches').expect(401);
    for (const path of ['/branches', '/halls', '/movies', '/showtimes', '/staff', '/dashboard']) {
      await request(s.app)
        .get(`/v1/admin${path}`)
        .set('Authorization', await as(s, f.alice))
        .expect(403);
    }
    await request(s.app)
      .post(`/v1/admin/showtimes/${uuid()}/cancel`)
      .set('Authorization', await as(s, door))
      .expect(403);
  });
});

describe('branches and movies', () => {
  it('creates, edits, lists and deletes a branch; a branch with showings cannot go', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const made = await a('post', '/branches')
      .send({ name: 'North', address: 'x', lat: 48, lng: 107 })
      .expect(201);
    await a('patch', `/branches/${made.body.id}`).send({ name: 'North 2' }).expect(200);
    const list = await a('get', '/branches').expect(200);
    expect(list.body.map((b: { name: string }) => b.name)).toEqual(['Central', 'North 2']);
    await a('delete', `/branches/${made.body.id}`).expect(204);
    await addShowtime(f, '2026-11-09T04:00:00Z');
    const busy = await a('delete', `/branches/${f.branch.id}`).expect(409);
    expect(busy.body.error).toBe('in_use');
    await a('patch', `/branches/${uuid()}`).send({ name: 'x' }).expect(404);
    await a('patch', '/branches/not-a-uuid').send({ name: 'x' }).expect(404);
  });

  it('creates and patches a movie, validating fields; a film with showings is not deletable', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const body = {
      title: 'New film',
      durationMin: 95,
      ageRating: '16+',
      posterUrl: 'http://files.test/media/p.jpg',
      releaseDate: '2026-12-01',
    };
    await a('post', '/movies')
      .send({ ...body, durationMin: 0 })
      .expect(400);
    const made = await a('post', '/movies').send(body).expect(201);
    expect(made.body).toMatchObject({
      status: 'soon',
      tone: '#2E6BF0',
      genres: [],
      backdropUrl: null,
    });
    const patched = await a('patch', `/movies/${made.body.id}`)
      .send({ status: 'archived' })
      .expect(200);
    expect(patched.body).toMatchObject({ status: 'archived', title: 'New film' });
    const all = await a('get', '/movies').expect(200);
    expect(all.body).toHaveLength(2);
    await a('delete', `/movies/${made.body.id}`).expect(204);
    await addShowtime(f, '2026-11-09T04:00:00Z');
    expect((await a('delete', `/movies/${f.movie.id}`).expect(409)).body.error).toBe('in_use');
  });
});

describe('halls', () => {
  it('generates seats on create and lets seat kinds change', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const made = await a('post', '/halls')
      .send({
        branchId: f.branch.id,
        name: 'Hall 2',
        screen_width_m: 8,
        screen_height_m: 4,
        gen: GEN,
      })
      .expect(201);
    expect(made.body).toMatchObject({ name: 'Hall 2', seatCount: 8, locked: false });
    expect(made.body.seats).toHaveLength(8);
    const first = made.body.seats[0];
    const changed = await a('patch', `/halls/${made.body.id}/seats`)
      .send({ changes: [{ seatId: first.id, kind: 'wheelchair' }] })
      .expect(200);
    expect(changed.body.seats.find((x: { id: string }) => x.id === first.id).kind).toBe(
      'wheelchair',
    );
    // a seat of another hall is not editable through this one
    await a('patch', `/halls/${made.body.id}/seats`)
      .send({ changes: [{ seatId: f.seatId(1), kind: 'blocked' }] })
      .expect(404);
    await a('post', '/halls')
      .send({ branchId: uuid(), name: 'X', screen_width_m: 8, screen_height_m: 4, gen: GEN })
      .expect(404);
  });

  it('regenerates an unused hall and locks it once any ticket referenced a seat', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const made = await a('post', '/halls')
      .send({
        branchId: f.branch.id,
        name: 'Hall 2',
        screen_width_m: 8,
        screen_height_m: 4,
        gen: GEN,
      })
      .expect(201);
    const regen = await a('put', `/halls/${made.body.id}/regenerate`)
      .send({ gen: { ...GEN, rows: 3 } })
      .expect(200);
    expect(regen.body.seatCount).toBe(12);

    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    await buy(s, f, show.id, f.alice, 1);
    const locked = await a('put', `/halls/${f.hall.id}/regenerate`).send({ gen: GEN }).expect(409);
    expect(locked.body.error).toBe('hall_locked');
    // still locked after the showing is cancelled: the ticket row keeps pointing at the seat
    await a('post', `/showtimes/${show.id}/cancel`).expect(200);
    await a('put', `/halls/${f.hall.id}/regenerate`).send({ gen: GEN }).expect(409);
    expect(await db.select().from(seats).where(eq(seats.hallId, f.hall.id))).toHaveLength(6);
  });

  it('refuses to block a seat that holds a ticket for an upcoming showing', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    await buy(s, f, show.id, f.alice, 2);
    const res = await a('patch', `/halls/${f.hall.id}/seats`)
      .send({ changes: [{ seatId: f.seatId(2), kind: 'blocked' }] })
      .expect(409);
    expect(res.body.error).toBe('seat_sold');
    await a('patch', `/halls/${f.hall.id}/seats`)
      .send({ changes: [{ seatId: f.seatId(3), kind: 'blocked' }] })
      .expect(200);
  });
});

describe('uploads', () => {
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ]);

  it('stores a real image under media/<uuid>.<ext> and returns its url', async () => {
    const s = setup();
    const f = await fixture();
    const res = await request(s.app)
      .post('/v1/admin/uploads')
      .set('Authorization', await as(s, f.admin))
      .attach('file', PNG, { filename: 'poster.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body.url).toMatch(/^http:\/\/files\.test\/media\/[0-9a-f-]{36}\.png$/);
    expect(s.stored).toHaveLength(1);
  });

  it('rejects a file whose bytes are not the image its header claims', async () => {
    const s = setup();
    const f = await fixture();
    const res = await request(s.app)
      .post('/v1/admin/uploads')
      .set('Authorization', await as(s, f.admin))
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(415);
    expect(res.body.error).toBe('unsupported_media_type');
    expect(s.stored).toHaveLength(0);
  });

  it('rejects other content types, missing files and files over 8 MB', async () => {
    const s = setup();
    const f = await fixture();
    const auth = await as(s, f.admin);
    await request(s.app)
      .post('/v1/admin/uploads')
      .set('Authorization', auth)
      .attach('file', PNG, { filename: 'x.gif', contentType: 'image/gif' })
      .expect(415);
    await request(s.app)
      .post('/v1/admin/uploads')
      .set('Authorization', auth)
      .field('a', 'b')
      .expect(400);
    const big = Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]);
    const res = await request(s.app)
      .post('/v1/admin/uploads')
      .set('Authorization', auth)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' })
      .expect(413);
    expect(res.body.error).toBe('file_too_large');
    await request(s.app)
      .post('/v1/admin/uploads')
      .attach('file', PNG, { filename: 'x.png', contentType: 'image/png' })
      .expect(401);
  });
});

describe('showtimes', () => {
  const body = (f: F, startsAt: string, over: object = {}) => ({
    movieId: f.movie.id,
    hallId: f.hall.id,
    startsAt,
    format: '2D',
    priceStandard: 10000,
    pricePremium: 15000,
    ...over,
  });

  it('refuses overlaps including the 15 minute cleaning gap', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    // 100 min film at 12:00Z ends 13:40Z; cleaning until 13:55Z.
    await a('post', '/showtimes').send(body(f, '2026-11-09T12:00:00Z')).expect(201);
    const clash = await a('post', '/showtimes').send(body(f, '2026-11-09T13:50:00Z')).expect(409);
    expect(clash.body.error).toBe('hall_busy');
    await a('post', '/showtimes').send(body(f, '2026-11-09T12:30:00Z')).expect(409);
    // starting so that the new film would run into the next one's start is a clash too
    await a('post', '/showtimes').send(body(f, '2026-11-09T10:30:00Z')).expect(409);
    await a('post', '/showtimes').send(body(f, '2026-11-09T13:55:00Z')).expect(201);
    await a('post', '/showtimes').send(body(f, '2026-11-09T10:05:00Z')).expect(201);
  });

  it('lets a cancelled showing free its slot, and validates prices', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const first = await a('post', '/showtimes').send(body(f, '2026-11-09T12:00:00Z')).expect(201);
    await a('post', `/showtimes/${first.body.id}/cancel`).expect(200);
    await a('post', '/showtimes').send(body(f, '2026-11-09T12:00:00Z')).expect(201);
    await a('post', '/showtimes')
      .send(body(f, '2026-11-10T12:00:00Z', { priceStandard: 0 }))
      .expect(400);
    await a('post', '/showtimes')
      .send(body(f, '2026-11-10T12:00:00Z', { pricePremium: 12.5 }))
      .expect(400);
    await a('post', '/showtimes')
      .send(body(f, '2026-11-10T12:00:00Z', { hallId: uuid() }))
      .expect(404);
  });

  it('edits freely until a ticket is sold, then locks time and hall but not prices', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const made = await a('post', '/showtimes').send(body(f, '2026-11-09T12:00:00Z')).expect(201);
    const moved = await a('patch', `/showtimes/${made.body.id}`)
      .send({ startsAt: '2026-11-09T14:00:00Z' })
      .expect(200);
    expect(moved.body.startsAt).toBe('2026-11-09T14:00:00.000Z');
    expect(moved.body.endsAt).toBe('2026-11-09T15:40:00.000Z');

    await buy(s, f, made.body.id, f.alice, 1);
    const locked = await a('patch', `/showtimes/${made.body.id}`)
      .send({ startsAt: '2026-11-09T16:00:00Z' })
      .expect(409);
    expect(locked.body.error).toBe('showtime_locked');
    await a('patch', `/showtimes/${made.body.id}`).send({ hallId: uuid() }).expect(409);
    // re-sending the current time is not a change
    await a('patch', `/showtimes/${made.body.id}`)
      .send({ startsAt: '2026-11-09T14:00:00Z', priceStandard: 12000 })
      .expect(200);
    const after = await a('get', `/showtimes/${made.body.id}`).expect(200);
    expect(after.body).toMatchObject({ priceStandard: 12000, sold: 1 });
    // the existing booking kept the price it was made at
    const [b] = await db.select().from(bookings);
    expect(b?.total).toBe(10000);
  });

  it('edit of a move that overlaps another showing is refused', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    await a('post', '/showtimes').send(body(f, '2026-11-09T12:00:00Z')).expect(201);
    const other = await a('post', '/showtimes').send(body(f, '2026-11-09T16:00:00Z')).expect(201);
    const res = await a('patch', `/showtimes/${other.body.id}`)
      .send({ startsAt: '2026-11-09T13:00:00Z' })
      .expect(409);
    expect(res.body.error).toBe('hall_busy');
  });
});

describe('cancelling a showtime', () => {
  it('cancels tickets and paid bookings, refunds, frees seats, emails once, and is idempotent', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    const paidA = await buy(s, f, show.id, f.alice, 1, 2);
    const paidB = await buy(s, f, show.id, f.bob, 3);
    // a pending booking and a bare hold
    const held = await createHolds(db, {
      showtimeId: show.id,
      seatIds: [f.seatId(4)],
      userId: f.alice.id,
      now: s.clock(),
    });
    const pendingRes = await request(s.app)
      .post('/v1/bookings')
      .set('Authorization', await as(s, f.alice))
      .send({ holdIds: held.holds.map((h) => h.id), idempotencyKey: uuid() })
      .expect(200);
    await createHolds(db, {
      showtimeId: show.id,
      seatIds: [f.seatId(5)],
      userId: f.bob.id,
      now: s.clock(),
    });
    s.messages.sent.length = 0; // drop the booking confirmations
    const deltas: { seatId: string; state: string }[] = [];
    s.seatHub.subscribe(show.id, (c) => deltas.push(...c));

    const res = await a('post', `/showtimes/${show.id}/cancel`).expect(200);
    expect(res.body).toEqual({
      id: show.id,
      status: 'cancelled',
      cancelledBookings: 2,
      cancelledTickets: 3,
    });

    expect((await bookingOf(paidA)).status).toBe('cancelled');
    expect((await bookingOf(paidB)).status).toBe('cancelled');
    expect((await bookingOf(pendingRes.body.id)).status).toBe('expired');
    expect((await paymentOf(paidA)).status).toBe('refunded');
    expect((await paymentOf(paidB)).status).toBe('refunded');
    expect((await paymentOf(paidA)).refundedAt).not.toBeNull();
    expect(await db.select().from(tickets).where(eq(tickets.status, 'valid'))).toHaveLength(0);
    expect(await db.select().from(seatHolds)).toHaveLength(0);
    expect(one((await db.select().from(showtimes))[0]).status).toBe('cancelled');
    expect(deltas.map((d) => d.state)).toEqual(Array(deltas.length).fill('free'));
    expect(new Set(deltas.map((d) => d.seatId))).toEqual(new Set([1, 2, 3, 4, 5].map(f.seatId)));

    // verified profile email for alice, nothing for bob (no email on file)
    const mails = s.messages.sent.filter((m) => m.channel === 'email');
    expect(mails.map((m) => m.to)).toEqual(['alice@x.mn']);
    expect(mails[0]?.body).toContain('Movie');

    const again = await a('post', `/showtimes/${show.id}/cancel`).expect(200);
    expect(again.body).toMatchObject({
      status: 'cancelled',
      cancelledBookings: 0,
      cancelledTickets: 0,
    });
    expect(s.messages.sent.filter((m) => m.channel === 'email')).toHaveLength(1);

    // a cancelled showing cannot be booked or edited
    await request(s.app)
      .post(`/v1/showtimes/${show.id}/holds`)
      .set('Authorization', await as(s, f.bob))
      .send({ seatIds: [f.seatId(6)] })
      .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
    await a('patch', `/showtimes/${show.id}`).send({ priceStandard: 5000 }).expect(409);
    await a('post', `/showtimes/${uuid()}/cancel`).expect(404);
  });

  it('refunds and emails once when two admins cancel at the same moment', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    const booking = await buy(s, f, show.id, f.alice, 1);
    s.messages.sent.length = 0;
    const [x, y] = await Promise.all([
      a('post', `/showtimes/${show.id}/cancel`),
      a('post', `/showtimes/${show.id}/cancel`),
    ]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect([x.body.cancelledBookings, y.body.cancelledBookings].sort()).toEqual([0, 1]);
    expect(s.messages.sent).toHaveLength(1);
    expect((await paymentOf(booking)).status).toBe('refunded');
  });

  it('falls back to a guest contact email', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    const guest = one((await db.insert(users).values({ role: 'guest' }).returning())[0]);
    const held = await createHolds(db, {
      showtimeId: show.id,
      seatIds: [f.seatId(1)],
      userId: guest.id,
      now: s.clock(),
    });
    const auth = await as(s, { id: guest.id, role: 'guest' });
    const created = await request(s.app)
      .post('/v1/bookings')
      .set('Authorization', auth)
      .send({
        holdIds: held.holds.map((h) => h.id),
        idempotencyKey: uuid(),
        contactEmail: 'Guest@Mail.mn',
      })
      .expect(200);
    await request(s.app)
      .post(`/v1/bookings/${created.body.id}/mock-pay`)
      .set('Authorization', auth)
      .expect(200);
    s.messages.sent.length = 0;
    await a('post', `/showtimes/${show.id}/cancel`).expect(200);
    expect(s.messages.sent.map((m) => m.to)).toEqual(['guest@mail.mn']);
  });

  it('keeps a failed refund owed and lets the sweeper finish it', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    class FlakyRefund extends MockPaymentProvider {
      failing = true;
      override async refund(invoiceId: string) {
        if (this.failing) throw new Error('provider down');
        await super.refund(invoiceId);
      }
    }
    let flaky: FlakyRefund | undefined;
    const s = setup((clock) => {
      flaky = new FlakyRefund(db, clock);
      return flaky;
    });
    const f = await fixture();
    const a = await api(s, f);
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    const booking = await buy(s, f, show.id, f.alice, 1);
    s.messages.sent.length = 0;
    await a('post', `/showtimes/${show.id}/cancel`).expect(200);
    expect((await bookingOf(booking)).status).toBe('cancelled');
    expect((await paymentOf(booking)).status).toBe('paid');
    // the customer is still told, and the row says money is owed
    expect(s.messages.sent.filter((m) => m.channel === 'email')).toHaveLength(1);

    (flaky as FlakyRefund).failing = false;
    await runSweep(db, s.clock(), s.seatHub, {
      settle: (id) => confirmBooking(db, id, s.deps),
      refund: (id) => refundOwed(db, id, s.deps),
    });
    expect((await paymentOf(booking)).status).toBe('refunded');
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('refunds a payment that lands after the cancellation instead of issuing a ticket', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    const held = await createHolds(db, {
      showtimeId: show.id,
      seatIds: [f.seatId(1)],
      userId: f.alice.id,
      now: s.clock(),
    });
    const created = await request(s.app)
      .post('/v1/bookings')
      .set('Authorization', await as(s, f.alice))
      .send({ holdIds: held.holds.map((h) => h.id), idempotencyKey: uuid() })
      .expect(200);
    await a('post', `/showtimes/${show.id}/cancel`).expect(200);
    const pay = await paymentOf(created.body.id);
    await s.deps.payments.checkPayment(pay.invoiceId);
    await new MockPaymentProvider(db, s.clock).markPaid(pay.invoiceId);
    await confirmBooking(db, created.body.id, s.deps);
    expect(await db.select().from(tickets)).toHaveLength(0);
    expect((await bookingOf(created.body.id)).status).toBe('failed');
    expect((await paymentOf(created.body.id)).status).toBe('refunded');
  });
});

describe('staff', () => {
  it('creates staff from a normalised phone, lists them and demotes on delete', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const made = await a('post', '/staff')
      .send({ name: 'Door A', phone: '+976 9911 2045', branchId: f.branch.id })
      .expect(201);
    expect(made.body).toMatchObject({
      phone: '+97699112045',
      branchId: f.branch.id,
      branchName: 'Central',
    });
    expect((await a('get', '/staff').expect(200)).body).toHaveLength(1);
    await a('post', '/staff')
      .send({ name: 'Dup', phone: '99112045', branchId: f.branch.id })
      .expect(409);
    await a('post', '/staff')
      .send({ name: 'Bad', phone: '123', branchId: f.branch.id })
      .expect(400);
    await a('delete', `/staff/${made.body.id}`).expect(204);
    const [row] = await db.select().from(users).where(eq(users.id, made.body.id));
    expect(row).toMatchObject({ role: 'customer', branchId: null, phone: '+97699112045' });
    expect((await a('get', '/staff').expect(200)).body).toHaveLength(0);
    // delete only touches staff
    await a('delete', `/staff/${f.admin.id}`).expect(404);
    expect(one((await db.select().from(users).where(eq(users.id, f.admin.id)))[0]).role).toBe(
      'admin',
    );
  });

  it('needs convert:true to promote a customer who already has that phone', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const send = { name: 'Bob', phone: '99000002', branchId: f.branch.id };
    expect((await a('post', '/staff').send(send).expect(409)).body.error).toBe('phone_in_use');
    const done = await a('post', '/staff')
      .send({ ...send, convert: true })
      .expect(201);
    expect(done.body.id).toBe(f.bob.id);
    expect(one((await db.select().from(users).where(eq(users.id, f.bob.id)))[0])).toMatchObject({
      role: 'staff',
      branchId: f.branch.id,
    });
    // an admin's phone is never convertible
    await db.update(users).set({ phone: '+97688000009' }).where(eq(users.id, f.admin.id));
    await a('post', '/staff')
      .send({ name: 'A', phone: '88000009', branchId: f.branch.id, convert: true })
      .expect(409);
  });
});

describe('reports and dashboard', () => {
  it('reports revenue equal to the sum of paid bookings, excluding cancelled ones', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const day1 = await addShowtime(f, '2026-11-08T11:00:00Z'); // 19:00 UB, 8 Nov
    const day2 = await addShowtime(f, '2026-11-09T11:00:00Z');
    const gone = await addShowtime(f, '2026-11-09T14:00:00Z');
    await db
      .update(seats)
      .set({ kind: 'premium' })
      .where(eq(seats.id, f.seatId(2)));
    await db
      .update(seats)
      .set({ kind: 'blocked' })
      .where(eq(seats.id, f.seatId(6)));
    await buy(s, f, day1.id, f.alice, 1, 2); // 10000 + 15000
    await buy(s, f, day2.id, f.bob, 3);
    await buy(s, f, gone.id, f.bob, 4);
    await a('post', `/showtimes/${gone.id}/cancel`).expect(200);

    const paid = await db.select().from(bookings).where(eq(bookings.status, 'paid'));
    const sum = paid.reduce((n, b) => n + b.total, 0);
    expect(sum).toBe(35000);

    const res = await a('get', '/reports?from=2026-11-08&to=2026-11-09').expect(200);
    expect(res.body.totals).toEqual({ revenue: sum, tickets: 3, occupancy: 0.3 }); // 3 sold / (5+5) capacity
    expect(res.body.byDay).toEqual([
      { date: '2026-11-08', revenue: 25000, tickets: 2, occupancy: 0.4 },
      { date: '2026-11-09', revenue: 10000, tickets: 1, occupancy: 0.2 },
    ]);
    expect(res.body.byMovie).toEqual([
      { movieId: f.movie.id, title: 'Movie', revenue: sum, tickets: 3, occupancy: 0.3 },
    ]);
    expect(res.body.byHall).toEqual([
      {
        hallId: f.hall.id,
        hallName: 'Hall 1',
        branchName: 'Central',
        revenue: sum,
        tickets: 3,
        occupancy: 0.3,
      },
    ]);

    const one8 = await a('get', '/reports?from=2026-11-08&to=2026-11-08').expect(200);
    expect(one8.body.totals.revenue).toBe(25000);
    const other = await a(
      'get',
      `/reports?from=2026-11-08&to=2026-11-09&branchId=${uuid()}`,
    ).expect(200);
    expect(other.body.totals).toEqual({ revenue: 0, tickets: 0, occupancy: 0 });
    await a('get', '/reports?from=2026-11-09&to=2026-11-08').expect(400);
    await a('get', '/reports?from=2025-01-01&to=2026-11-08').expect(400);
    await a('get', '/reports').expect(400);
  });

  it('attributes a 00:30 Ulaanbaatar showing to its local date', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const late = await addShowtime(f, '2026-11-08T16:30:00Z'); // 00:30 on 9 Nov in UB
    await buy(s, f, late.id, f.alice, 1);
    const res = await a('get', '/reports?from=2026-11-09&to=2026-11-09').expect(200);
    expect(res.body.totals.revenue).toBe(10000);
    const prev = await a('get', '/reports?from=2026-11-08&to=2026-11-08').expect(200);
    expect(prev.body.totals.revenue).toBe(0);
  });

  it('builds the dashboard: today vs yesterday, refunds, hourly, top films, upcoming', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    await addShowtime(f, '2026-11-08T13:00:00Z');
    await buy(s, f, show.id, f.alice, 1, 2); // bought 18:00 UB: hour 18
    s.clock.advance(-24 * 60 * MIN);
    const old = await addShowtime(f, '2026-11-07T11:00:00Z');
    await buy(s, f, old.id, f.bob, 3); // yesterday
    s.clock.advance(24 * 60 * MIN);
    const doomed = await addShowtime(f, '2026-11-08T14:00:00Z');
    await buy(s, f, doomed.id, f.bob, 4);
    await a('post', `/showtimes/${doomed.id}/cancel`).expect(200);

    const res = await a('get', '/dashboard').expect(200);
    expect(res.body.today).toMatchObject({ revenue: 20000, tickets: 2 });
    expect(res.body.yesterday).toMatchObject({ revenue: 10000, tickets: 1 });
    expect(res.body.refundsToday).toEqual({ count: 1, amount: 10000 });
    expect(res.body.hourlySales).toHaveLength(24);
    expect(res.body.hourlySales[18]).toEqual({ hour: 18, revenue: 20000, tickets: 2 });
    expect(res.body.topFilms).toEqual([
      {
        movieId: f.movie.id,
        title: 'Movie',
        posterUrl: 'p.jpg',
        tone: '#112233',
        revenue: 20000,
        tickets: 2,
      },
    ]);
    expect(res.body.upcoming.map((u: { sold: number }) => u.sold)).toEqual([2, 0]);
    expect(res.body.upcoming[0]).toMatchObject({
      movieTitle: 'Movie',
      hallName: 'Hall 1',
      capacity: 6,
    });
  });
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x20, 0, 0, 0]),
  Buffer.from('WEBP'),
  Buffer.alloc(32),
]);

describe('uploads by type', () => {
  it('accepts JPEG and WebP and names them by their real type', async () => {
    const s = setup();
    const f = await fixture();
    const auth = await as(s, f.admin);
    const jpg = await request(s.app)
      .post('/v1/admin/uploads')
      .set('Authorization', auth)
      .attach('file', JPEG, { filename: 'a.jpeg', contentType: 'image/jpeg' })
      .expect(201);
    const webp = await request(s.app)
      .post('/v1/admin/uploads')
      .set('Authorization', auth)
      .attach('file', WEBP, { filename: 'a.webp', contentType: 'image/webp' })
      .expect(201);
    expect(jpg.body.url).toMatch(/\.jpg$/);
    expect(webp.body.url).toMatch(/\.webp$/);
  });

  it('names a spoofed upload by its bytes, never its claimed name or type', async () => {
    const s = setup();
    const f = await fixture();
    const auth = await as(s, f.admin);
    // a JPEG sent as "x.png" is stored as jpg
    const real = await request(s.app)
      .post('/v1/admin/uploads')
      .set('Authorization', auth)
      .attach('file', JPEG, { filename: 'x.png', contentType: 'image/png' })
      .expect(201);
    expect(real.body.url).toMatch(/\.jpg$/);
    // text pretending to be a png is refused
    await request(s.app)
      .post('/v1/admin/uploads')
      .set('Authorization', auth)
      .attach('file', Buffer.from('not an image at all'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(415);
    expect(s.stored).toHaveLength(1);
  });
});

async function secondHall(f: F) {
  const hall = one(
    (
      await db
        .insert(halls)
        .values({
          branchId: f.branch.id,
          name: 'Hall 2',
          screenWidthM: 10,
          screenHeightM: 5,
          screenXM: 0,
        })
        .returning()
    )[0],
  );
  await db.insert(seats).values({ hallId: hall.id, rowLabel: 'A', number: 1, xM: 0, yM: 1 });
  return hall;
}

describe('moving showings with customers mid-purchase', () => {
  it('refuses a hall change while a hold or a pending booking exists', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const other = await secondHall(f);
    const show = await addShowtime(f, '2026-11-09T12:00:00Z');
    const held = await createHolds(db, {
      showtimeId: show.id,
      seatIds: [f.seatId(1)],
      userId: f.alice.id,
      now: s.clock(),
    });
    const res = await a('patch', `/showtimes/${show.id}`).send({ hallId: other.id }).expect(409);
    expect(res.body.error).toBe('showtime_locked');
    await request(s.app)
      .post('/v1/bookings')
      .set('Authorization', await as(s, f.alice))
      .send({ holdIds: held.holds.map((h) => h.id), idempotencyKey: uuid() })
      .expect(200);
    await a('patch', `/showtimes/${show.id}`)
      .send({ startsAt: '2026-11-09T15:00:00Z' })
      .expect(409);
    // prices stay editable
    await a('patch', `/showtimes/${show.id}`).send({ priceStandard: 11000 }).expect(200);
    // once the hold has expired and the booking with it, the move goes through
    s.clock.advance(11 * MIN);
    await runSweep(db, s.clock(), s.seatHub);
    await a('patch', `/showtimes/${show.id}`).send({ hallId: other.id }).expect(200);
  });

  it('refuses to create or move a showing into the past and to cancel one that started', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const base = {
      movieId: f.movie.id,
      hallId: f.hall.id,
      priceStandard: 10000,
      pricePremium: 15000,
    };
    const past = await a('post', '/showtimes')
      .send({ ...base, startsAt: '2026-11-08T09:00:00Z' })
      .expect(400);
    expect(past.body.error).toBe('showtime_in_past');
    const ok = await a('post', '/showtimes')
      .send({ ...base, startsAt: '2026-11-09T12:00:00Z' })
      .expect(201);
    await a('patch', `/showtimes/${ok.body.id}`)
      .send({ startsAt: '2026-11-07T12:00:00Z' })
      .expect(400);
    s.clock.advance(48 * 60 * MIN);
    const later = await api(s, f);
    const started = await later('post', `/showtimes/${ok.body.id}/cancel`).expect(409);
    expect(started.body.error).toBe('showtime_started');
  });

  it('lets exactly one of two concurrent creates win the same hall slot', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const body = {
      movieId: f.movie.id,
      hallId: f.hall.id,
      startsAt: '2026-11-09T12:00:00Z',
      priceStandard: 10000,
      pricePremium: 15000,
    };
    const res = await Promise.all([
      a('post', '/showtimes').send(body),
      a('post', '/showtimes').send(body),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.select().from(showtimes)).toHaveLength(1);
  });

  it('cancel and a confirm paused mid-transaction both finish without a 500', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    const held = await createHolds(db, {
      showtimeId: show.id,
      seatIds: [f.seatId(1)],
      userId: f.alice.id,
      now: s.clock(),
    });
    const created = await request(s.app)
      .post('/v1/bookings')
      .set('Authorization', await as(s, f.alice))
      .send({ holdIds: held.holds.map((h) => h.id), idempotencyKey: uuid() })
      .expect(200);
    const bookingId = created.body.id as string;
    const pay = await paymentOf(bookingId);
    await new MockPaymentProvider(db, s.clock).markPaid(pay.invoiceId);

    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let locked: () => void = () => {};
    const lockedBooking = new Promise<void>((r) => {
      locked = r;
    });
    // What confirm does inside its transaction, held open before the commit.
    const confirmLike = db.transaction(async (tx) => {
      await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update');
      await tx.insert(tickets).values({
        bookingId,
        showtimeId: show.id,
        seatId: f.seatId(1),
        qrToken: 'qr',
      });
      await tx.update(payments).set({ status: 'paid' }).where(eq(payments.id, pay.id));
      await tx.delete(seatHolds).where(eq(seatHolds.bookingId, bookingId));
      await tx
        .update(bookings)
        .set({ status: 'paid', paidAt: s.clock() })
        .where(eq(bookings.id, bookingId));
      locked();
      await gate;
    });
    await lockedBooking;
    const cancelling = a('post', `/showtimes/${show.id}/cancel`).then((r) => r);
    await new Promise((r) => setTimeout(r, 200));
    release();
    await confirmLike;
    const res = await cancelling;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancelledBookings: 1, cancelledTickets: 1 });
    expect((await bookingOf(bookingId)).status).toBe('cancelled');
    expect((await paymentOf(bookingId)).status).toBe('refunded');
  });
});

describe('hall and movie edits respect customers', () => {
  it('locks regeneration and seat blocking while holds or pending bookings exist, and republishes', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const show = await addShowtime(f, '2026-11-09T12:00:00Z');
    await createHolds(db, {
      showtimeId: show.id,
      seatIds: [f.seatId(1)],
      userId: f.alice.id,
      now: s.clock(),
    });
    const lockedRegen = await a('put', `/halls/${f.hall.id}/regenerate`)
      .send({ gen: GEN })
      .expect(409);
    expect(lockedRegen.body.error).toBe('hall_locked');
    const held = await a('patch', `/halls/${f.hall.id}/seats`)
      .send({ changes: [{ seatId: f.seatId(1), kind: 'blocked' }] })
      .expect(409);
    expect(held.body.error).toBe('seat_held');

    const deltas: { seatId: string; state: string }[] = [];
    s.seatHub.subscribe(show.id, (c) => deltas.push(...c));
    await a('patch', `/halls/${f.hall.id}/seats`)
      .send({ changes: [{ seatId: f.seatId(2), kind: 'premium' }] })
      .expect(200);
    expect(deltas).toEqual([{ seatId: f.seatId(2), state: 'free' }]);

    s.clock.advance(11 * MIN);
    await runSweep(db, s.clock(), s.seatHub);
    await a('put', `/halls/${f.hall.id}/regenerate`).send({ gen: GEN }).expect(200);
  });

  it('refuses a new running time while future showings exist', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    await a('patch', `/movies/${f.movie.id}`).send({ durationMin: 120 }).expect(200);
    await addShowtime(f, '2026-11-09T12:00:00Z');
    const res = await a('patch', `/movies/${f.movie.id}`).send({ durationMin: 90 }).expect(409);
    expect(res.body.error).toBe('movie_locked');
    await a('patch', `/movies/${f.movie.id}`)
      .send({ durationMin: 120, title: 'Renamed' })
      .expect(200);
  });
});

describe('admin validation', () => {
  it('rejects absurd prices, impossible dates and non-http urls', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    const show = {
      movieId: f.movie.id,
      hallId: f.hall.id,
      startsAt: '2026-11-09T12:00:00Z',
      priceStandard: 10000,
      pricePremium: 15000,
    };
    await a('post', '/showtimes')
      .send({ ...show, priceStandard: 10_000_001 })
      .expect(400);
    await a('get', '/reports?from=2026-02-31&to=2026-03-01').expect(400);
    const movie = {
      title: 'T',
      durationMin: 90,
      ageRating: '12+',
      posterUrl: 'https://x.mn/p.jpg',
      releaseDate: '2026-12-01',
    };
    await a('post', '/movies')
      .send({ ...movie, posterUrl: 'javascript:alert(1)' })
      .expect(400);
    await a('post', '/movies')
      .send({ ...movie, trailerUrl: 'ftp://x.mn/t' })
      .expect(400);
    await a('post', '/movies')
      .send({ ...movie, releaseDate: '2026-02-30' })
      .expect(400);
    await a('post', '/movies').send(movie).expect(201);
  });

  it('lists showtimes with a truncation flag', async () => {
    const s = setup();
    const f = await fixture();
    const a = await api(s, f);
    await addShowtime(f, '2026-11-09T12:00:00Z');
    const res = await a('get', '/showtimes').expect(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('refund claim', () => {
  it('lets only one of two concurrent refund attempts call the provider', async () => {
    let calls = 0;
    class Slow extends MockPaymentProvider {
      override async refund(invoiceId: string) {
        calls++;
        await new Promise((r) => setTimeout(r, 100));
        await super.refund(invoiceId);
      }
    }
    const s = setup((clock) => new Slow(db, clock));
    const f = await fixture();
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    const booking = await buy(s, f, show.id, f.alice, 1);
    await db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, booking));
    await Promise.all([refundOwed(db, booking, s.deps), refundOwed(db, booking, s.deps)]);
    expect(calls).toBe(1);
    expect((await paymentOf(booking)).status).toBe('refunded');
  });

  it('takes over a claim whose process died', async () => {
    const s = setup();
    const f = await fixture();
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    const booking = await buy(s, f, show.id, f.alice, 1);
    await db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, booking));
    await db
      .update(payments)
      .set({ status: 'refunding', refundClaimedAt: s.clock() })
      .where(eq(payments.bookingId, booking));
    await refundOwed(db, booking, s.deps);
    expect((await paymentOf(booking)).status).toBe('refunding');
    s.clock.advance(3 * MIN);
    await refundOwed(db, booking, s.deps);
    expect((await paymentOf(booking)).status).toBe('refunded');
  });
});

describe('strict dates', () => {
  it.each(['2026-13-01', '2026-02-32', '2026-00-10', '2026-02-30'])(
    'answers 400, not 500, for %s',
    async (bad) => {
      const s = setup();
      const f = await fixture();
      const a = await api(s, f);
      await a('get', `/reports?from=${bad}&to=2026-12-31`).expect(400);
      await a('get', `/reports?from=2026-01-01&to=${bad}`).expect(400);
    },
  );
});

describe('refund claim ownership and provider timeout', () => {
  async function cancelledBooking(s: S, f: F) {
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    const booking = await buy(s, f, show.id, f.alice, 1);
    await db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, booking));
    return booking;
  }

  it('a call that was taken over cannot settle or revert the new owner’s claim', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const outcome of ['succeeds', 'fails'] as const) {
      await resetDb();
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      class Gated extends MockPaymentProvider {
        override async refund(invoiceId: string) {
          await gate;
          if (outcome === 'fails') throw new Error('provider down');
          await super.refund(invoiceId);
        }
      }
      const s = setup((clock) => new Gated(db, clock));
      const f = await fixture();
      const booking = await cancelledBooking(s, f);
      const first = refundOwed(db, booking, s.deps);
      await new Promise((r) => setTimeout(r, 100));
      const taken = new Date(s.clock().getTime() + 5);
      await db
        .update(payments)
        .set({ refundClaimedAt: taken })
        .where(eq(payments.bookingId, booking));
      release();
      await first;
      const pay = await paymentOf(booking);
      expect(pay.status).toBe('refunding');
      expect(pay.refundClaimedAt?.getTime()).toBe(taken.getTime());
    }
    quiet.mockRestore();
  });

  it('a provider call that never answers releases the claim and cannot stall the sweeper', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Hung extends MockPaymentProvider {
      override refund(invoiceId: string): Promise<void> {
        if (this.hang.has(invoiceId)) return new Promise<void>(() => {});
        return super.refund(invoiceId);
      }
      hang = new Set<string>();
    }
    let hung: Hung | undefined;
    const s = setup((clock) => {
      hung = new Hung(db, clock);
      return hung;
    });
    const f = await fixture();
    const first = await cancelledBooking(s, f);
    const showB = await addShowtime(f, '2026-11-08T12:00:00Z');
    const second = await buy(s, f, showB.id, f.bob, 2);
    await db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, second));
    hung?.hang.add((await paymentOf(first)).invoiceId);

    await runSweep(db, s.clock(), s.seatHub, {
      settle: (id) => confirmBooking(db, id, s.deps, 50),
      refund: (id) => refundOwed(db, id, s.deps, 50),
    });
    const stuck = await paymentOf(first);
    expect(stuck.status).toBe('paid');
    expect(stuck.refundClaimedAt).toBeNull();
    expect((await paymentOf(second)).status).toBe('refunded');
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('a checkPayment that never answers rejects instead of hanging', async () => {
    class Hung extends MockPaymentProvider {
      override checkPayment(): Promise<'pending' | 'paid' | 'failed'> {
        return new Promise(() => {});
      }
    }
    const s = setup((clock) => new Hung(db, clock));
    const f = await fixture();
    const show = await addShowtime(f, '2026-11-08T11:00:00Z');
    const held = await createHolds(db, {
      showtimeId: show.id,
      seatIds: [f.seatId(1)],
      userId: f.alice.id,
      now: s.clock(),
    });
    const created = await request(s.app)
      .post('/v1/bookings')
      .set('Authorization', await as(s, f.alice))
      .send({ holdIds: held.holds.map((h) => h.id), idempotencyKey: uuid() })
      .expect(200);
    await expect(confirmBooking(db, created.body.id, s.deps, 50)).rejects.toThrow(/timed out/);
  });
});
