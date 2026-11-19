import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import {
  bookings,
  branches,
  halls,
  loyaltyEntries,
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
import { verifyQr } from '../src/lib/sign';
import { signAccessToken } from '../src/lib/tokens';
import type { Messages } from '../src/messages';
import { MockPaymentProvider } from '../src/payments/mock';
import { confirmBooking, refundOwed } from '../src/services/bookings';
import { createHolds } from '../src/services/holds';
import { cancelShowtime } from '../src/services/showtimes';
import { pointsFor } from '../src/shared';
import { fakeMessages, fixedClock, makeTestApp, one, resetDb } from './helpers';

const MIN = 60_000;

async function fixture(clock: () => Date) {
  const b = one(
    (await db.insert(branches).values({ name: 'B', address: 'a', lat: 0, lng: 0 }).returning())[0],
  );
  const h = one(
    (
      await db
        .insert(halls)
        .values({ branchId: b.id, name: 'H1', screenWidthM: 10, screenHeightM: 5, screenXM: 5 })
        .returning()
    )[0],
  );
  const rows = await db
    .insert(seats)
    .values(
      Array.from({ length: 6 }, (_, i) => ({
        hallId: h.id,
        rowLabel: 'A',
        number: i + 1,
        xM: i,
        yM: 1,
        kind: i === 5 ? ('premium' as const) : ('standard' as const),
      })),
    )
    .returning();
  const m = one(
    (
      await db
        .insert(movies)
        .values({
          title: 'Movie',
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
          priceStandard: 10000,
          pricePremium: 15000,
        })
        .returning()
    )[0],
  );
  const user = async (v: Partial<typeof users.$inferInsert>) => {
    const u = one(
      (
        await db
          .insert(users)
          .values({ role: 'customer', emailVerifiedAt: clock(), ...v })
          .returning()
      )[0],
    );
    return { id: u.id, auth: `Bearer ${await signAccessToken(u, clock())}` };
  };
  const seatId = (n: number) => one(rows.find((s) => s.number === n)).id;
  return {
    show,
    seatId,
    user,
    alice: await user({ phone: '+97699000001' }),
    bob: await user({ phone: '+97699000002' }),
  };
}

type F = Awaited<ReturnType<typeof fixture>>;

function setup(opts: { messages?: Messages; spy?: boolean } = {}) {
  const clock = fixedClock('2026-11-08T04:00:00Z');
  const hub = new SeatHub();
  const messages = opts.messages ?? fakeMessages();
  const payments = opts.spy ? new SpyPayments(db, clock) : new MockPaymentProvider(db, clock);
  const deps = { db, clock, seatHub: hub, messages, payments };
  const app = makeTestApp(deps);
  return { clock, hub, messages, payments, deps, app };
}

const hold = async (clock: () => Date, f: F, userId: string, ...nums: number[]) => {
  const r = await createHolds(db, {
    showtimeId: f.show.id,
    seatIds: nums.map(f.seatId),
    userId,
    now: clock(),
  });
  return r.holds.map((x) => x.id);
};

const key = () => crypto.randomUUID();

const hooksFor = (s: ReturnType<typeof setup>) => ({
  settle: (id: string) => confirmBooking(db, id, s.deps),
  refund: (id: string) => refundOwed(db, id, s.deps),
});

/** Provider whose refund fails on demand and records whether a transaction was open. */
class SpyPayments extends MockPaymentProvider {
  failRefunds = 0;
  refundCalls = 0;
  openTransactionsDuringRefund: number[] = [];
  override async refund(invoiceId: string) {
    this.refundCalls++;
    const open = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%' and pid <> pg_backend_pid()`,
    );
    this.openTransactionsDuringRefund.push(Number(open.rows[0]?.n));
    if (this.failRefunds > 0) {
      this.failRefunds--;
      throw new Error('provider down');
    }
    return super.refund(invoiceId);
  }
}

const book = (
  app: ReturnType<typeof makeTestApp>,
  auth: string,
  body: { holdIds: string[]; idempotencyKey?: string; contactEmail?: string },
) =>
  request(app)
    .post('/v1/bookings')
    .set('Authorization', auth)
    .send({ idempotencyKey: key(), ...body });

const pay = (app: ReturnType<typeof makeTestApp>, auth: string, id: string) =>
  request(app).post(`/v1/bookings/${id}/mock-pay`).set('Authorization', auth);

beforeEach(async () => {
  await resetDb();
});

describe('creating a booking', () => {
  it('prices seats, attaches holds, creates one invoice and an order number', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1, 6);
    const res = await book(s.app, f.alice.auth, { holdIds }).expect(200);
    expect(res.body.total).toBe(25000);
    expect(res.body.status).toBe('pending');
    expect(res.body.orderNo).toMatch(/^OC-\d{5,}$/);
    expect(res.body.expiresAt).toBe('2026-11-08T04:10:00.000Z');
    expect(res.body.invoice.invoiceId).toMatch(/^mock_/);
    expect(res.body.showtime.movie.title).toBe('Movie');
    const held = await db.select().from(seatHolds).where(eq(seatHolds.bookingId, res.body.id));
    expect(held).toHaveLength(2);
    expect(await db.select().from(payments)).toHaveLength(1);
  });

  it('makes a hold in a booking undeletable', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    await book(s.app, f.alice.auth, { holdIds }).expect(200);
    const res = await request(s.app)
      .delete(`/v1/holds/${holdIds[0]}`)
      .set('Authorization', f.alice.auth)
      .expect(409);
    expect(res.body.error).toBe('hold_in_booking');
  });

  it('requires a contact email from guests only', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const g = await f.user({ role: 'guest' });
    const holdIds = await hold(s.clock, f, g.id, 1);
    const no = await book(s.app, g.auth, { holdIds }).expect(400);
    expect(no.body.error).toBe('contact_email_required');
    await book(s.app, g.auth, { holdIds, contactEmail: 'Guest@Mail.MN' }).expect(200);
    const [row] = await db.select().from(bookings);
    expect(row?.contactEmail).toBe('guest@mail.mn');
    const aliceHolds = await hold(s.clock, f, f.alice.id, 2);
    await book(s.app, f.alice.auth, { holdIds: aliceHolds }).expect(200);
  });

  it('rejects holds that are not the caller’s, expired or already booked', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const aliceHolds = await hold(s.clock, f, f.alice.id, 1);
    const bobHolds = await hold(s.clock, f, f.bob.id, 2);
    expect((await book(s.app, f.bob.auth, { holdIds: aliceHolds })).status).toBe(409);
    await book(s.app, f.bob.auth, { holdIds: bobHolds }).expect(200);
    const again = await book(s.app, f.bob.auth, { holdIds: bobHolds }).expect(409);
    expect(again.body.error).toBe('holds_unavailable');
    s.clock.advance(11 * MIN);
    const late = await book(s.app, f.alice.auth, { holdIds: aliceHolds }).expect(409);
    expect(late.body.error).toBe('holds_unavailable');
  });

  it('replays the same key for the same user and never for another', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    const idempotencyKey = key();
    const first = await book(s.app, f.alice.auth, { holdIds, idempotencyKey }).expect(200);
    const second = await book(s.app, f.alice.auth, { holdIds, idempotencyKey }).expect(200);
    expect(second.body.id).toBe(first.body.id);
    const stolen = await book(s.app, f.bob.auth, { holdIds, idempotencyKey }).expect(409);
    expect(stolen.body.error).toBe('idempotency_conflict');
    expect(JSON.stringify(stolen.body)).not.toContain(first.body.id);
    expect(await db.select().from(bookings)).toHaveLength(1);
  });

  it('turns concurrent duplicate creates into one booking and one invoice', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1, 2);
    const idempotencyKey = key();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => book(s.app, f.alice.auth, { holdIds, idempotencyKey })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(new Set(results.map((r) => r.body.invoice.invoiceId)).size).toBe(1);
    expect(await db.select().from(bookings)).toHaveLength(1);
    expect(await db.select().from(payments)).toHaveLength(1);
  });

  it('lets another user race one key: one wins, the other gets idempotency_conflict', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const a = await hold(s.clock, f, f.alice.id, 1);
    const b = await hold(s.clock, f, f.bob.id, 2);
    const idempotencyKey = key();
    const [ra, rb] = await Promise.all([
      book(s.app, f.alice.auth, { holdIds: a, idempotencyKey }),
      book(s.app, f.bob.auth, { holdIds: b, idempotencyKey }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect(await db.select().from(bookings)).toHaveLength(1);
  });
});

describe('paying and confirming', () => {
  it('issues signed tickets, drops the holds, publishes sold and emails the contact', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const seen: unknown[] = [];
    s.hub.subscribe(f.show.id, (c) => seen.push(c));
    const holdIds = await hold(s.clock, f, f.alice.id, 1, 2);
    const created = await book(s.app, f.alice.auth, {
      holdIds,
      contactEmail: 'alice@mail.mn',
    }).expect(200);
    const poll = await request(s.app)
      .get(`/v1/bookings/${created.body.id}`)
      .set('Authorization', f.alice.auth)
      .expect(200);
    expect(poll.body.status).toBe('pending');

    const paid = await pay(s.app, f.alice.auth, created.body.id).expect(200);
    expect(paid.body.status).toBe('paid');
    expect(paid.body.ticketIds).toHaveLength(2);
    expect(paid.body.invoice).toBeNull();

    const rows = await db.select().from(tickets);
    expect(rows).toHaveLength(2);
    for (const t of rows) {
      expect(verifyQr(t.qrToken)).toEqual({ ticketId: t.id, showtimeId: f.show.id });
    }
    expect(await db.select().from(seatHolds)).toHaveLength(0);
    expect(seen.at(-1)).toEqual(
      expect.arrayContaining([
        { seatId: f.seatId(1), state: 'sold' },
        { seatId: f.seatId(2), state: 'sold' },
      ]),
    );
    const sent = (s.messages as ReturnType<typeof fakeMessages>).sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('alice@mail.mn');
    expect(sent[0]?.body).toContain(created.body.orderNo);
    expect(sent[0]?.body).toContain('A1, A2');
  });

  it('emails the verified profile email in preference to the contact email', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const carol = await f.user({ email: 'carol@mail.mn', emailVerifiedAt: s.clock() });
    const holdIds = await hold(s.clock, f, carol.id, 1);
    const created = await book(s.app, carol.auth, { holdIds, contactEmail: 'other@mail.mn' });
    await pay(s.app, carol.auth, created.body.id).expect(200);
    expect((s.messages as ReturnType<typeof fakeMessages>).sent.map((m) => m.to)).toEqual([
      'carol@mail.mn',
    ]);
  });

  it('uses the contact email when the profile email is unverified', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const dan = await f.user({ role: 'guest', email: 'dan@mail.mn', emailVerifiedAt: null });
    const holdIds = await hold(s.clock, f, dan.id, 1);
    const created = await book(s.app, dan.auth, { holdIds, contactEmail: 'contact@mail.mn' });
    await pay(s.app, dan.auth, created.body.id).expect(200);
    expect((s.messages as ReturnType<typeof fakeMessages>).sent.map((m) => m.to)).toEqual([
      'contact@mail.mn',
    ]);
  });

  it('confirming twice, even in parallel, yields one set of tickets and one email', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1, 2, 3);
    const created = await book(s.app, f.alice.auth, { holdIds, contactEmail: 'a@mail.mn' });
    const [p] = await db.select().from(payments);
    await s.payments.markPaid(one(p).invoiceId);
    await Promise.all([
      confirmBooking(db, created.body.id, s.deps),
      confirmBooking(db, created.body.id, s.deps),
      confirmBooking(db, created.body.id, s.deps),
    ]);
    await confirmBooking(db, created.body.id, s.deps);
    expect(await db.select().from(tickets)).toHaveLength(3);
    expect((s.messages as ReturnType<typeof fakeMessages>).sent).toHaveLength(1);
    const [b] = await db.select().from(bookings);
    expect(b?.status).toBe('paid');
  });

  it('does nothing while the provider says pending', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    const created = await book(s.app, f.alice.auth, { holdIds });
    await confirmBooking(db, created.body.id, s.deps);
    expect(await db.select().from(tickets)).toHaveLength(0);
    expect(one((await db.select().from(bookings))[0]).status).toBe('pending');
  });

  it('refunds when the hold expired and the seats were taken by someone else', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1, 2);
    const created = await book(s.app, f.alice.auth, { holdIds, contactEmail: 'a@mail.mn' });
    s.clock.advance(11 * MIN);
    // Bob takes seat 1 over Alice's expired hold.
    await hold(s.clock, f, f.bob.id, 1);
    const [p] = await db.select().from(payments);
    await s.payments.markPaid(one(p).invoiceId);

    const res = await request(s.app)
      .get(`/v1/bookings/${created.body.id}`)
      .set('Authorization', f.alice.auth)
      .expect(200);
    expect(res.body.status).toBe('failed');
    expect(res.body.seatsLost).toBe(true);
    expect(res.body.ticketIds).toEqual([]);
    expect(await db.select().from(tickets)).toHaveLength(0);
    const pay1 = one((await db.select().from(payments))[0]);
    expect(pay1.status).toBe('refunded');
    expect((pay1.raw as { state: string }).state).toBe('refunded');
    // Bob's hold survives; Alice's other hold is gone.
    const left = await db.select().from(seatHolds);
    expect(left.map((h) => h.userId)).toEqual([f.bob.id]);
    expect((s.messages as ReturnType<typeof fakeMessages>).sent).toHaveLength(0);
  });

  it('refunds when the ticket index refuses a seat, leaving no partial tickets', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1, 2);
    const created = await book(s.app, f.alice.auth, { holdIds });
    // Simulate a ticket for seat 2 that slipped past the hold checks.
    const other = await db
      .insert(bookings)
      .values({
        userId: f.bob.id,
        showtimeId: f.show.id,
        total: 1,
        idempotencyKey: key(),
      })
      .returning();
    await db.insert(tickets).values({
      bookingId: one(other[0]).id,
      showtimeId: f.show.id,
      seatId: f.seatId(2),
      qrToken: 'x',
    });
    const [p] = await db.select().from(payments);
    await s.payments.markPaid(one(p).invoiceId);
    await confirmBooking(db, created.body.id, s.deps);

    const [b] = await db.select().from(bookings).where(eq(bookings.id, created.body.id));
    expect(b?.status).toBe('failed');
    expect(b?.seatsLost).toBe(true);
    expect(await db.select().from(tickets)).toHaveLength(1);
    expect(one((await db.select().from(payments))[0]).status).toBe('refunded');
    expect(await db.select().from(seatHolds)).toHaveLength(0);
  });

  it('keeps the booking paid with its tickets when the email cannot be sent', async () => {
    const broken: Messages = {
      async sms() {},
      async email() {
        throw new Error('provider down');
      },
    };
    const s = setup({ messages: broken });
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    const created = await book(s.app, f.alice.auth, { holdIds, contactEmail: 'a@mail.mn' });
    const res = await pay(s.app, f.alice.auth, created.body.id).expect(200);
    expect(res.body.status).toBe('paid');
    expect(await db.select().from(tickets)).toHaveLength(1);
  });

  it('hides bookings from other users and refuses to pay a settled booking twice', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    const created = await book(s.app, f.alice.auth, { holdIds });
    await request(s.app)
      .get(`/v1/bookings/${created.body.id}`)
      .set('Authorization', f.bob.auth)
      .expect(404);
    await pay(s.app, f.bob.auth, created.body.id).expect(404);
    await pay(s.app, f.alice.auth, created.body.id).expect(200);
    const again = await pay(s.app, f.alice.auth, created.body.id).expect(409);
    expect(again.body.error).toBe('booking_not_pending');
  });

  it('answers the provider callback stub', async () => {
    const s = setup();
    await request(s.app).post('/v1/payments/callback/qpay').send({}).expect(204);
  });
});

describe('sweeper', () => {
  it('expires a stale pending booking and frees its seats', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1, 2);
    const created = await book(s.app, f.alice.auth, { holdIds });
    const seen: unknown[] = [];
    s.hub.subscribe(f.show.id, (c) => seen.push(c));

    await runSweep(db, s.clock(), s.hub);
    expect(one((await db.select().from(bookings))[0]).status).toBe('pending');
    expect(await db.select().from(seatHolds)).toHaveLength(2);

    s.clock.advance(11 * MIN);
    await runSweep(db, s.clock(), s.hub);
    const [b] = await db.select().from(bookings).where(eq(bookings.id, created.body.id));
    expect(b?.status).toBe('expired');
    expect(await db.select().from(seatHolds)).toHaveLength(0);
    expect(seen).toEqual([
      expect.arrayContaining([
        { seatId: f.seatId(1), state: 'free' },
        { seatId: f.seatId(2), state: 'free' },
      ]),
    ]);
  });

  it('frees plain expired holds and leaves live ones', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    await hold(s.clock, f, f.alice.id, 1);
    s.clock.advance(5 * MIN);
    await hold(s.clock, f, f.bob.id, 2);
    s.clock.advance(6 * MIN);
    await runSweep(db, s.clock(), s.hub);
    const left = await db.select().from(seatHolds);
    expect(left.map((h) => h.seatId)).toEqual([f.seatId(2)]);
  });

  it('settles a payment that landed in the last moment instead of expiring it', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    const created = await book(s.app, f.alice.auth, { holdIds });
    const [p] = await db.select().from(payments);
    await s.payments.markPaid(one(p).invoiceId);
    s.clock.advance(11 * MIN);
    await runSweep(db, s.clock(), s.hub, hooksFor(s));
    const [b] = await db.select().from(bookings).where(eq(bookings.id, created.body.id));
    expect(b?.status).toBe('paid');
    expect(await db.select().from(tickets)).toHaveLength(1);
  });

  it('retries a refund that failed, from the sweeper, outside any transaction', async () => {
    const s = setup({ spy: true });
    const spy = s.payments as SpyPayments;
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    const created = await book(s.app, f.alice.auth, { holdIds });
    s.clock.advance(11 * MIN);
    await hold(s.clock, f, f.bob.id, 1);
    const [p] = await db.select().from(payments);
    await s.payments.markPaid(one(p).invoiceId);
    spy.failRefunds = 1;

    await confirmBooking(db, created.body.id, s.deps);
    const [b] = await db.select().from(bookings);
    expect(b?.status).toBe('failed');
    expect(b?.seatsLost).toBe(true);
    expect(one((await db.select().from(payments))[0]).status).toBe('paid');

    await runSweep(db, s.clock(), s.hub, hooksFor(s));
    expect(one((await db.select().from(payments))[0]).status).toBe('refunded');
    expect(spy.refundCalls).toBe(2);
    expect(spy.openTransactionsDuringRefund).toEqual([0, 0]);
    await runSweep(db, s.clock(), s.hub, hooksFor(s));
    expect(spy.refundCalls).toBe(2);
  });

  it('refunds a payment that lands after the booking expired, without a customer poll', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    const created = await book(s.app, f.alice.auth, { holdIds });
    s.clock.advance(11 * MIN);
    await runSweep(db, s.clock(), s.hub, hooksFor(s));
    expect(one((await db.select().from(bookings))[0]).status).toBe('expired');

    const [p] = await db.select().from(payments);
    await s.payments.markPaid(one(p).invoiceId);
    s.clock.advance(MIN);
    await runSweep(db, s.clock(), s.hub, hooksFor(s));
    const [b] = await db.select().from(bookings).where(eq(bookings.id, created.body.id));
    expect(b?.status).toBe('failed');
    expect(b?.seatsLost).toBe(true);
    expect(one((await db.select().from(payments))[0]).status).toBe('refunded');
    expect(await db.select().from(tickets)).toHaveLength(0);
  });

  it('stops watching an expired booking after the invoice expiry plus the margin', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    await book(s.app, f.alice.auth, { holdIds });
    s.clock.advance(11 * MIN);
    await runSweep(db, s.clock(), s.hub, hooksFor(s));
    const [p] = await db.select().from(payments);
    await s.payments.markPaid(one(p).invoiceId);
    s.clock.advance(3 * MIN);
    await runSweep(db, s.clock(), s.hub, hooksFor(s));
    expect(one((await db.select().from(bookings))[0]).status).toBe('expired');
  });

  it('deletes every hold of a non-pending booking, expired or not', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1, 2);
    const created = await book(s.app, f.alice.auth, { holdIds });
    await db.update(bookings).set({ status: 'failed' }).where(eq(bookings.id, created.body.id));
    const seen: unknown[] = [];
    s.hub.subscribe(f.show.id, (c) => seen.push(c));
    await runSweep(db, s.clock(), s.hub);
    expect(await db.select().from(seatHolds)).toHaveLength(0);
    expect(seen).toHaveLength(1);
  });
});

describe('checkout robustness', () => {
  it('refuses to invoice a hold on a seat that already has a valid ticket', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    const other = await db
      .insert(bookings)
      .values({ userId: f.bob.id, showtimeId: f.show.id, total: 1, idempotencyKey: key() })
      .returning();
    await db.insert(tickets).values({
      bookingId: one(other[0]).id,
      showtimeId: f.show.id,
      seatId: f.seatId(1),
      qrToken: 'x',
    });
    const res = await book(s.app, f.alice.auth, { holdIds }).expect(409);
    expect(res.body.error).toBe('seat_taken');
    expect(await db.select().from(payments)).toHaveLength(0);
    expect(await db.select().from(bookings).where(eq(bookings.userId, f.alice.id))).toHaveLength(0);
  });

  it('completes 11 concurrent checkouts from different users', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const extra = await db
      .insert(seats)
      .values(
        Array.from({ length: 11 }, (_, i) => ({
          hallId: f.show.hallId,
          rowLabel: 'Z',
          number: i + 1,
          xM: i,
          yM: 9,
        })),
      )
      .returning();
    const users = await Promise.all(extra.map((_, i) => f.user({ phone: `+9769910000${i}` })));
    const holds = await Promise.all(
      users.map(async (u, i) => {
        const r = await createHolds(db, {
          showtimeId: f.show.id,
          seatIds: [one(extra[i]).id],
          userId: u.id,
          now: s.clock(),
        });
        return r.holds.map((h) => h.id);
      }),
    );
    const results = await Promise.all(
      users.map((u, i) => book(s.app, u.auth, { holdIds: holds[i] ?? [] })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(11).fill(200));
    expect(await db.select().from(payments)).toHaveLength(11);
  }, 30_000);

  it('points the invoice at the real mock-pay route and caps its expiry at the booking', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    s.clock.advance(5 * MIN);
    const res = await book(s.app, f.alice.auth, { holdIds }).expect(200);
    expect(res.body.invoice.qrText).toContain(`/v1/bookings/${res.body.id}/mock-pay`);
    expect(res.body.invoice.expiresAt).toBe(res.body.expiresAt);
  });

  it('allows one payment row per booking', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    const created = await book(s.app, f.alice.auth, { holdIds });
    await expect(
      db
        .insert(payments)
        .values({ bookingId: created.body.id, provider: 'mock', invoiceId: 'dup', amount: 1 }),
    ).rejects.toThrow();
  });
});

describe('bonus points', () => {
  const points = (auth: string) => request(testApp).get('/v1/me/points').set('Authorization', auth);
  let testApp: ReturnType<typeof makeTestApp>;

  const paid = async (
    s: ReturnType<typeof setup>,
    f: F,
    who: { id: string; auth: string },
    ...n: number[]
  ) => {
    const holdIds = await hold(s.clock, f, who.id, ...n);
    const created = await book(s.app, who.auth, { holdIds, contactEmail: 'p@mail.mn' }).expect(200);
    await pay(s.app, who.auth, created.body.id).expect(200);
    return created.body.id as string;
  };

  it('computes floor(total x 1%)', () => {
    expect(pointsFor(25000)).toBe(250);
    expect(pointsFor(15050)).toBe(150);
    expect(pointsFor(5700)).toBe(57);
    expect(pointsFor(99)).toBe(0);
  });

  it('credits a customer once when the booking is paid, and lists it newest first', async () => {
    const s = setup();
    testApp = s.app;
    const f = await fixture(s.clock);
    const id = await paid(s, f, f.alice, 1, 6);
    await confirmBooking(db, id, s.deps);
    await confirmBooking(db, id, s.deps);
    const rows = await db.select().from(loyaltyEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ points: 250, kind: 'earn', bookingId: id });
    const res = await points(f.alice.auth).expect(200);
    expect(res.body.balance).toBe(250);
    expect(res.body.memberNo).toBeGreaterThanOrEqual(100001);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({
      points: 250,
      kind: 'earn',
      movieTitle: 'Movie',
      bookingId: id,
    });
    const second = await paid(s, f, f.alice, 2);
    const after = await points(f.alice.auth).expect(200);
    expect(after.body.balance).toBe(350);
    expect(after.body.entries.map((e: { bookingId: string }) => e.bookingId)).toEqual([second, id]);
  });

  it('gives guests no points but still answers /me/points', async () => {
    const s = setup();
    testApp = s.app;
    const f = await fixture(s.clock);
    const g = await f.user({ role: 'guest' });
    await paid(s, f, g, 1);
    expect(await db.select().from(loyaltyEntries)).toHaveLength(0);
    const res = await points(g.auth).expect(200);
    expect(res.body).toMatchObject({ balance: 0, entries: [] });
  });

  it('earns nothing when the seats were lost and the payment is refunded', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    const created = await book(s.app, f.alice.auth, { holdIds }).expect(200);
    await db.delete(seatHolds).where(eq(seatHolds.bookingId, created.body.id));
    const [p] = await db.select().from(payments);
    await s.payments.markPaid(one(p).invoiceId);
    await confirmBooking(db, created.body.id, s.deps);
    expect(await db.select().from(loyaltyEntries)).toHaveLength(0);
  });

  it('reverses once when the showing is cancelled and the booking refunded', async () => {
    const s = setup();
    testApp = s.app;
    const f = await fixture(s.clock);
    const id = await paid(s, f, f.alice, 1, 6);
    await cancelShowtime(db, s.deps, f.show.id);
    await cancelShowtime(db, s.deps, f.show.id);
    await refundOwed(db, id, s.deps);
    const rows = await db.select().from(loyaltyEntries).orderBy(loyaltyEntries.kind);
    expect(rows.map((r) => [r.kind, r.points])).toEqual([
      ['earn', 250],
      ['reverse', -250],
    ]);
    const res = await points(f.alice.auth).expect(200);
    expect(res.body.balance).toBe(0);
    expect(res.body.entries).toHaveLength(2);
  });

  it('never shows a negative balance', async () => {
    const s = setup();
    testApp = s.app;
    const f = await fixture(s.clock);
    await db.insert(loyaltyEntries).values({ userId: f.alice.id, points: -40, kind: 'reverse' });
    expect((await points(f.alice.auth).expect(200)).body.balance).toBe(0);
  });

  it('keeps entries after a booking row is removed (movie title null)', async () => {
    const s = setup();
    testApp = s.app;
    const f = await fixture(s.clock);
    await db.insert(loyaltyEntries).values({ userId: f.alice.id, points: 10, kind: 'earn' });
    const res = await points(f.alice.auth).expect(200);
    expect(res.body.entries[0]).toMatchObject({ movieTitle: null, bookingId: null });
  });

  it('gives every user a unique member number starting at 100001', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const g = await f.user({ role: 'guest' });
    const rows = await db.select({ n: users.memberNo }).from(users);
    expect(new Set(rows.map((r) => r.n)).size).toBe(rows.length);
    expect(Math.min(...rows.map((r) => r.n))).toBe(100001);
    const me = await request(s.app).get('/v1/me').set('Authorization', g.auth).expect(200);
    expect(me.body.memberNo).toBeGreaterThanOrEqual(100001);
  });

  it('blocks a customer without a verified email before any hold or payment work', async () => {
    const s = setup();
    const f = await fixture(s.clock);
    const holdIds = await hold(s.clock, f, f.alice.id, 1);
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, f.alice.id));
    const res = await book(s.app, f.alice.auth, { holdIds }).expect(403);
    expect(res.body.error).toBe('email_required');
    expect(await db.select().from(payments)).toHaveLength(0);
    await db
      .update(users)
      .set({ email: 'a@mail.mn', emailVerifiedAt: s.clock() })
      .where(eq(users.id, f.alice.id));
    await book(s.app, f.alice.auth, { holdIds }).expect(200);
  });
});
