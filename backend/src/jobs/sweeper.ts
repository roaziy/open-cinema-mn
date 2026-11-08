import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { AppDeps } from '../app';
import type { Db } from '../db/client';
import { bookings, payments, seatHolds } from '../db/schema';
import type { SeatHub } from '../lib/seat-hub';
import { confirmBooking, refundOwed } from '../services/bookings';
import { nonFreeSeats } from '../services/seat-state';

export const SWEEP_INTERVAL_MS = 30_000;

export const LATE_PAYMENT_MARGIN_MS = 2 * 60_000;

/** Provider-facing work the sweeper delegates; omitted in tests that only exercise expiry. */
export type SweepHooks = {
  /** Check the invoice and confirm or fail the booking. */
  settle(bookingId: string): Promise<void>;
  /** Pay back a failed booking whose payment is still `paid`. */
  refund(bookingId: string): Promise<void>;
};

/**
 * Sweeper pass:
 *  1. pending bookings past `expires_at` get one last look at their invoice, then become `expired`;
 *  2. expired holds nobody waits on, and every hold of a non-pending booking, are deleted and freed;
 *  3. expired bookings whose invoice is still unpaid are settled until the invoice expiry plus a
 *     margin, so a late payment is refunded without waiting for the customer to poll;
 *  4. refunds that failed earlier are retried.
 */
export async function runSweep(
  db: Db,
  now: Date,
  seatHub: SeatHub,
  hooks?: SweepHooks,
): Promise<void> {
  const each = async (ids: string[], fn: (id: string) => Promise<void>) => {
    for (const id of ids) {
      try {
        await fn(id);
      } catch (err) {
        console.error('sweeper step failed', err);
      }
    }
  };
  if (hooks) {
    const due = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.status, 'pending'), lte(bookings.expiresAt, now)));
    await each(
      due.map((d) => d.id),
      hooks.settle,
    );
  }
  const freed = await db.transaction(async (tx) => {
    await tx
      .update(bookings)
      .set({ status: 'expired' })
      .where(and(eq(bookings.status, 'pending'), lte(bookings.expiresAt, now)));
    return tx
      .delete(seatHolds)
      .where(
        or(
          and(lte(seatHolds.expiresAt, now), sql`${seatHolds.bookingId} is null`),
          inArray(
            seatHolds.bookingId,
            tx
              .select({ id: bookings.id })
              .from(bookings)
              .where(sql`${bookings.status} <> 'pending'`),
          ),
        ),
      )
      .returning({ showtimeId: seatHolds.showtimeId, seatId: seatHolds.seatId });
  });
  const byShow = new Map<string, string[]>();
  for (const f of freed) byShow.set(f.showtimeId, [...(byShow.get(f.showtimeId) ?? []), f.seatId]);
  for (const [showtimeId, seatIds] of byShow) {
    const taken = await nonFreeSeats(db, showtimeId, now);
    seatHub.publish(
      showtimeId,
      seatIds.map((seatId) => ({ seatId, state: taken.get(seatId) ?? 'free' })),
    );
  }
  if (!hooks) return;
  const late = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.status, 'expired'),
        eq(payments.status, 'pending'),
        sql`(${payments.raw}->>'expiresAt')::timestamptz + ${LATE_PAYMENT_MARGIN_MS / 1000} * interval '1 second' >= ${now.toISOString()}::timestamptz`,
      ),
    );
  await each(
    late.map((l) => l.id),
    hooks.settle,
  );
  const owed = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(and(eq(bookings.status, 'failed'), eq(payments.status, 'paid')));
  await each(
    owed.map((o) => o.id),
    hooks.refund,
  );
}

/** Starts the periodic sweep; the returned function stops it. */
export function startSweeper(deps: AppDeps): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runSweep(deps.db, deps.clock(), deps.seatHub, {
        settle: (id) => confirmBooking(deps.db, id, deps),
        refund: (id) => refundOwed(deps.db, id, deps),
      });
    } catch (err) {
      console.error('sweep failed', err);
    } finally {
      running = false;
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
