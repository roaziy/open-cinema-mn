import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { bookings, loyaltyEntries, movies, showtimes, users } from '../db/schema';
import { type MyPoints, pointsFor } from '../shared';
import type { Tx } from './holds';

const MAX_ENTRIES = 50;

/**
 * Credits the points of a booking that was just paid, in the caller's transaction. Only customers
 * earn; a second call for the same booking is a no-op (partial unique index).
 */
export async function earnPoints(
  tx: Tx,
  b: { id: string; userId: string; total: number },
): Promise<void> {
  const points = pointsFor(b.total);
  if (points <= 0) return;
  const [u] = await tx.select({ role: users.role }).from(users).where(eq(users.id, b.userId));
  if (u?.role !== 'customer') return;
  await tx
    .insert(loyaltyEntries)
    .values({ userId: b.userId, bookingId: b.id, points, kind: 'earn' })
    .onConflictDoNothing();
}

/** Takes back what a booking earned when its payment is refunded. Once per booking. */
export async function reversePoints(tx: Tx, bookingId: string): Promise<void> {
  const [earned] = await tx
    .select({ userId: loyaltyEntries.userId, points: loyaltyEntries.points })
    .from(loyaltyEntries)
    .where(sql`${loyaltyEntries.bookingId} = ${bookingId} and ${loyaltyEntries.kind} = 'earn'`);
  if (!earned) return;
  await tx
    .insert(loyaltyEntries)
    .values({ userId: earned.userId, bookingId, points: -earned.points, kind: 'reverse' })
    .onConflictDoNothing();
}

export async function myPoints(db: Db, userId: string, memberNo: number): Promise<MyPoints> {
  const [sum] = await db
    .select({ total: sql<number>`coalesce(sum(${loyaltyEntries.points}), 0)::int` })
    .from(loyaltyEntries)
    .where(eq(loyaltyEntries.userId, userId));
  const rows = await db
    .select({
      id: loyaltyEntries.id,
      points: loyaltyEntries.points,
      kind: loyaltyEntries.kind,
      createdAt: loyaltyEntries.createdAt,
      bookingId: loyaltyEntries.bookingId,
      movieTitle: movies.title,
    })
    .from(loyaltyEntries)
    .leftJoin(bookings, eq(bookings.id, loyaltyEntries.bookingId))
    .leftJoin(showtimes, eq(showtimes.id, bookings.showtimeId))
    .leftJoin(movies, eq(movies.id, showtimes.movieId))
    .where(eq(loyaltyEntries.userId, userId))
    .orderBy(desc(loyaltyEntries.createdAt), desc(loyaltyEntries.id))
    .limit(MAX_ENTRIES);
  return {
    balance: Math.max(0, sum?.total ?? 0),
    memberNo,
    entries: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}
