import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { AppDeps } from '../app';
import type { Db } from '../db/client';
import { bookings, seatHolds } from '../db/schema';
import type { SeatHub } from '../lib/seat-hub';
import { confirmBooking } from '../services/bookings';
import { nonFreeSeats } from '../services/seat-state';

export const SWEEP_INTERVAL_MS = 30_000;

/**
 * Sweeper pass: pending bookings past `expires_at` become `expired` (after one last look at
 * their invoice via `settle`), then expired holds nobody is waiting on are deleted and freed.
 */
export async function runSweep(
  db: Db,
  now: Date,
  seatHub: SeatHub,
  settle?: (bookingId: string) => Promise<void>,
): Promise<void> {
  if (settle) {
    const due = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.status, 'pending'), lte(bookings.expiresAt, now)));
    for (const { id } of due) {
      try {
        await settle(id);
      } catch (err) {
        console.error('sweeper settle failed', err);
      }
    }
  }
  const freed = await db.transaction(async (tx) => {
    await tx
      .update(bookings)
      .set({ status: 'expired' })
      .where(and(eq(bookings.status, 'pending'), lte(bookings.expiresAt, now)));
    return tx
      .delete(seatHolds)
      .where(
        and(
          lte(seatHolds.expiresAt, now),
          or(
            sql`${seatHolds.bookingId} is null`,
            inArray(
              seatHolds.bookingId,
              tx
                .select({ id: bookings.id })
                .from(bookings)
                .where(sql`${bookings.status} <> 'pending'`),
            ),
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
}

/** Starts the periodic sweep; the returned function stops it. */
export function startSweeper(deps: AppDeps): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runSweep(deps.db, deps.clock(), deps.seatHub, (id) =>
        confirmBooking(deps.db, id, deps),
      );
    } catch (err) {
      console.error('sweep failed', err);
    } finally {
      running = false;
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
