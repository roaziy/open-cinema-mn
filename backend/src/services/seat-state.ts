import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { seatHolds, tickets } from '../db/schema';

/** Seats that are not free for a showtime. Sold wins over held. */
export async function nonFreeSeats(
  db: Db,
  showtimeId: string,
  now: Date,
): Promise<Map<string, 'held' | 'sold'>> {
  const [soldRows, heldRows] = await Promise.all([
    db
      .select({ seatId: tickets.seatId })
      .from(tickets)
      .where(and(eq(tickets.showtimeId, showtimeId), eq(tickets.status, 'valid'))),
    db
      .select({ seatId: seatHolds.seatId })
      .from(seatHolds)
      .where(and(eq(seatHolds.showtimeId, showtimeId), gt(seatHolds.expiresAt, now))),
  ]);
  const out = new Map<string, 'held' | 'sold'>();
  for (const r of heldRows) out.set(r.seatId, 'held');
  for (const r of soldRows) out.set(r.seatId, 'sold');
  return out;
}
