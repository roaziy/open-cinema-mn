import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/client';
import {
  bookings,
  branches,
  halls,
  movies,
  payments,
  seats,
  showtimes,
  tickets,
  users,
} from '../src/db/schema';
import { runSweep } from '../src/jobs/sweeper';
import { startDraining } from '../src/lib/drain';
import { SeatHub } from '../src/lib/seat-hub';
import type { PaymentProvider } from '../src/payments/provider';
import { confirmBooking, PROVIDER_TIMEOUT_MS, refundOwed } from '../src/services/bookings';
import { cancelShowtime } from '../src/services/showtimes';
import { fakeMessages, fixedClock, makeTestApp, one, resetDb } from './helpers';

// The real flag is one-way for the whole process; here it can be put back to model a restart.
const drain = vi.hoisted(() => ({ on: false }));
vi.mock('../src/lib/drain', () => ({
  isDraining: () => drain.on,
  startDraining: () => {
    drain.on = true;
  },
}));

beforeEach(resetDb);
afterEach(() => {
  drain.on = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('while draining', () => {
  it('asks clients to close the connection after the response', async () => {
    const app = makeTestApp();
    const before = await request(app).get('/v1/branches').set('Connection', 'keep-alive');
    expect(before.headers.connection).toBe('keep-alive');
    startDraining();
    const after = await request(app).get('/v1/branches').set('Connection', 'keep-alive');
    expect(after.status).toBe(200);
    expect(after.headers.connection).toBe('close');
  });

  it('makes the seat hub refuse new streams before it has ended the open ones', () => {
    const hub = new SeatHub();
    expect(hub.isClosing).toBe(false);
    startDraining();
    expect(hub.isClosing).toBe(true);
  });
});

/** A showing with two seats. */
async function showing() {
  const [b] = await db
    .insert(branches)
    .values({ name: 'B', address: 'a', lat: 0, lng: 0 })
    .returning();
  const [h] = await db
    .insert(halls)
    .values({ branchId: one(b).id, name: 'H', screenWidthM: 10, screenHeightM: 5, screenXM: 5 })
    .returning();
  const seatRows = await db
    .insert(seats)
    .values([
      { hallId: one(h).id, rowLabel: 'A', number: 1, xM: 1, yM: 1 },
      { hallId: one(h).id, rowLabel: 'A', number: 2, xM: 2, yM: 1 },
    ])
    .returning();
  const [m] = await db
    .insert(movies)
    .values({
      title: 'M',
      durationMin: 90,
      ageRating: '12+',
      posterUrl: 'p',
      status: 'now',
      releaseDate: '2026-11-01',
    })
    .returning();
  const [st] = await db
    .insert(showtimes)
    .values({
      movieId: one(m).id,
      hallId: one(h).id,
      startsAt: new Date('2026-11-08T11:00:00Z'),
      priceStandard: 10000,
      pricePremium: 15000,
    })
    .returning();
  return { show: one(st), seatRows };
}

/** A showing two customers paid for, one seat each. */
async function paidShowing() {
  const { show, seatRows } = await showing();
  const invoices = new Map<string, string>(); // invoice id -> booking id
  for (const [i, seat] of seatRows.entries()) {
    const [u] = await db
      .insert(users)
      .values({ role: 'customer', phone: `+9769900000${i}` })
      .returning();
    const [bk] = await db
      .insert(bookings)
      .values({
        userId: one(u).id,
        showtimeId: show.id,
        status: 'paid',
        total: 10000,
        contactEmail: `c${i}@x.mn`,
        idempotencyKey: crypto.randomUUID(),
        seatIds: [seat.id],
        paidAt: new Date('2026-11-08T03:00:00Z'),
      })
      .returning();
    const booking = one(bk);
    await db.insert(tickets).values({
      bookingId: booking.id,
      showtimeId: show.id,
      seatId: seat.id,
      qrToken: `qr-${i}`,
    });
    const invoiceId = `inv-${i}`;
    await db.insert(payments).values({
      bookingId: booking.id,
      provider: 'mock',
      invoiceId,
      status: 'paid',
      amount: 10000,
    });
    invoices.set(invoiceId, booking.id);
  }
  return { show, invoices };
}

const paymentStatus = async (bookingId: string) =>
  one((await db.select().from(payments).where(eq(payments.bookingId, bookingId)))[0]).status;

describe('cancelling a showing during the drain', () => {
  it('starts no new refund once draining; the sweeper pays it after the restart', async () => {
    const { show, invoices } = await paidShowing();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = fixedClock('2026-11-08T04:00:00Z');
    const messages = fakeMessages();
    const seatHub = new SeatHub();
    // Each refund holds the provider for almost the whole provider timeout.
    const slowRefund = vi.fn(
      (_invoiceId: string) => new Promise<void>((r) => setTimeout(r, PROVIDER_TIMEOUT_MS - 1_000)),
    );
    const deps = {
      clock,
      messages,
      seatHub,
      payments: { refund: slowRefund } as unknown as PaymentProvider,
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const cancelling = cancelShowtime(db, deps, show.id);
    await vi.waitFor(() => expect(slowRefund).toHaveBeenCalledTimes(1));
    startDraining(); // SIGINT while the first refund waits on the provider
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS);
    const result = await cancelling;

    expect(slowRefund).toHaveBeenCalledTimes(1);
    const firstInvoice = one(slowRefund.mock.calls[0])[0];
    const first = one(invoices.get(firstInvoice));
    const second = one([...invoices.values()].find((id) => id !== first));
    expect(result).toMatchObject({ cancelledBookings: 2, cancelledTickets: 2 });
    expect(await paymentStatus(first)).toBe('refunded');
    expect(await paymentStatus(second)).toBe('paid'); // still owed
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      `draining: refund of ${second} left to the sweeper`,
    );
    // Both customers still hear about the cancellation.
    expect(messages.sent.map((m) => m.to).sort()).toEqual(['c0@x.mn', 'c1@x.mn']);

    // Next boot: a fresh process is not draining, and the sweeper's owed query finds the booking.
    vi.useRealTimers();
    drain.on = false;
    const fastRefund = vi.fn(async (_invoiceId: string) => {});
    const fresh = { ...deps, payments: { refund: fastRefund } as unknown as PaymentProvider };
    await runSweep(db, clock(), seatHub, {
      settle: async () => {},
      refund: (id) => refundOwed(db, id, fresh),
    });
    expect(fastRefund.mock.calls.map(([invoice]) => invoices.get(invoice))).toEqual([second]);
    expect(await paymentStatus(second)).toBe('refunded');
  });
});

/** A pending booking whose holds are gone, so a paid invoice can only end in a refund. */
async function lostSeatsBooking() {
  const { show, seatRows } = await showing();
  const [u] = await db
    .insert(users)
    .values({ role: 'customer', phone: '+97699000009' })
    .returning();
  const [bk] = await db
    .insert(bookings)
    .values({
      userId: one(u).id,
      showtimeId: show.id,
      total: 10000,
      idempotencyKey: crypto.randomUUID(),
      seatIds: [one(seatRows[0]).id],
      expiresAt: new Date('2026-11-08T04:10:00Z'),
    })
    .returning();
  const invoiceId = 'inv-lost';
  await db
    .insert(payments)
    .values({ bookingId: one(bk).id, provider: 'mock', invoiceId, amount: 10000 });
  return { bookingId: one(bk).id, invoiceId };
}

describe('settling a booking during the drain', () => {
  it('starts no refund for lost seats once draining; the sweeper pays it after the restart', async () => {
    const { bookingId, invoiceId } = await lostSeatsBooking();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = fixedClock('2026-11-08T04:00:00Z');
    let answer!: (state: 'paid') => void;
    const checkPayment = vi.fn((_invoiceId: string) => new Promise<'paid'>((r) => (answer = r)));
    const refund = vi.fn(async (_invoiceId: string) => {});
    const deps = {
      clock,
      messages: fakeMessages(),
      seatHub: new SeatHub(),
      payments: { checkPayment, refund } as unknown as PaymentProvider,
    };

    const settling = confirmBooking(db, bookingId, deps);
    await vi.waitFor(() => expect(checkPayment).toHaveBeenCalledOnce());
    startDraining(); // SIGINT while the invoice check waits on the provider
    answer('paid');
    await settling;

    expect(refund).not.toHaveBeenCalled();
    const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(b).toMatchObject({ status: 'failed', seatsLost: true });
    expect(await paymentStatus(bookingId)).toBe('paid'); // owed, never claimed
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      `draining: refund of ${bookingId} left to the sweeper`,
    );

    // Next boot: a fresh process is not draining, and the sweeper's owed query finds the booking.
    drain.on = false;
    await runSweep(db, clock(), deps.seatHub, {
      settle: async () => {},
      refund: (id) => refundOwed(db, id, deps),
    });
    expect(refund).toHaveBeenCalledExactlyOnceWith(invoiceId);
    expect(await paymentStatus(bookingId)).toBe('refunded');
  });
});
