import type { Hold, SeatDelta } from '@open-cinema/shared';
import { and, count, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { seatHolds, seats, showtimes, tickets } from '../db/schema';
import { AppError, badRequest, conflict, isUniqueViolation, notFound } from '../lib/errors';

export const HOLD_TTL_MS = 10 * 60_000;
export const MAX_SEATS_PER_BOOKING = 10;

/** 409 `seat_taken`; carries the seats that could not be held. */
export class SeatTakenError extends AppError {
  constructor(public readonly seatIds: string[]) {
    super(409, 'seat_taken');
    this.name = 'SeatTakenError';
  }
}

type HoldRow = typeof seatHolds.$inferSelect;

export const toHold = (h: HoldRow): Hold => ({
  id: h.id,
  seatId: h.seatId,
  showtimeId: h.showtimeId,
  expiresAt: h.expiresAt.toISOString(),
});

export type CreateHoldsInput = {
  showtimeId: string;
  seatIds: string[];
  userId: string;
  now: Date;
};

/** `changes` lists only seats that newly became held (re-holds do not change seat state). */
export type CreateHoldsResult = { holds: Hold[]; changes: SeatDelta[] };

/**
 * Holds seats for a user in one transaction. The unique index on (showtime, seat) is the real
 * guard: of two concurrent inserts for one seat, Postgres lets exactly one commit.
 */
export async function createHolds(db: Db, input: CreateHoldsInput): Promise<CreateHoldsResult> {
  const seatIds = [...new Set(input.seatIds)];
  try {
    return await db.transaction((tx) => holdInTransaction(tx, { ...input, seatIds }));
  } catch (err) {
    if (!isUniqueViolation(err) && !isDeadlock(err)) throw err;
    // The transaction is aborted; find out who beat us from a fresh read. Only seats held by
    // someone else or sold count as lost; the user's own holds are never a conflict.
    const [others, sold] = await Promise.all([
      db
        .select({ seatId: seatHolds.seatId })
        .from(seatHolds)
        .where(
          and(
            eq(seatHolds.showtimeId, input.showtimeId),
            inArray(seatHolds.seatId, seatIds),
            gt(seatHolds.expiresAt, input.now),
            ne(seatHolds.userId, input.userId),
          ),
        ),
      db
        .select({ seatId: tickets.seatId })
        .from(tickets)
        .where(
          and(
            eq(tickets.showtimeId, input.showtimeId),
            eq(tickets.status, 'valid'),
            inArray(tickets.seatId, seatIds),
          ),
        ),
    ]);
    const lostIds = new Set([...others, ...sold].map((r) => r.seatId));
    const lost = seatIds.filter((id) => lostIds.has(id));
    throw new SeatTakenError(lost.length > 0 ? lost : seatIds);
  }
}

const isDeadlock = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '40P01' || e?.cause?.code === '40P01';
};

/** Serialises all hold changes of one user on one showtime (cap check, re-hold, release). */
export const lockUserShowtime = (tx: Tx, userId: string, showtimeId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId} || ':' || ${showtimeId}, 0))`,
  );

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function holdInTransaction(
  tx: Tx,
  { showtimeId, seatIds, userId, now }: CreateHoldsInput,
): Promise<CreateHoldsResult> {
  await lockUserShowtime(tx, userId, showtimeId);
  const [show] = await tx
    .select({ status: showtimes.status, startsAt: showtimes.startsAt, hallId: showtimes.hallId })
    .from(showtimes)
    .where(eq(showtimes.id, showtimeId))
    .limit(1)
    // Blocks an admin moving or cancelling the showing until this hold is committed.
    .for('share');
  if (!show) throw notFound();
  if (show.status !== 'scheduled' || show.startsAt <= now) {
    throw badRequest('showtime_closed');
  }

  const seatRows = await tx
    .select({ id: seats.id, kind: seats.kind })
    .from(seats)
    .where(and(eq(seats.hallId, show.hallId), inArray(seats.id, seatIds)));
  if (seatRows.length !== seatIds.length) throw badRequest('invalid_seat');

  const sold = await tx
    .select({ seatId: tickets.seatId })
    .from(tickets)
    .where(
      and(
        eq(tickets.showtimeId, showtimeId),
        eq(tickets.status, 'valid'),
        inArray(tickets.seatId, seatIds),
      ),
    );
  const unavailable = new Set([
    ...seatRows.filter((s) => s.kind === 'blocked').map((s) => s.id),
    ...sold.map((t) => t.seatId),
  ]);
  if (unavailable.size > 0) throw new SeatTakenError([...unavailable]);

  await tx
    .delete(seatHolds)
    .where(
      and(
        eq(seatHolds.showtimeId, showtimeId),
        inArray(seatHolds.seatId, seatIds),
        lte(seatHolds.expiresAt, now),
      ),
    );

  const active = await tx
    .select()
    .from(seatHolds)
    .where(
      and(
        eq(seatHolds.showtimeId, showtimeId),
        inArray(seatHolds.seatId, seatIds),
        gt(seatHolds.expiresAt, now),
      ),
    );
  const others = active.filter((h) => h.userId !== userId);
  if (others.length > 0) throw new SeatTakenError(others.map((h) => h.seatId));

  const mineHere = new Set(active.map((h) => h.seatId));
  const fresh = seatIds.filter((id) => !mineHere.has(id));
  const [{ n: alreadyMine } = { n: 0 }] = await tx
    .select({ n: count() })
    .from(seatHolds)
    .where(
      and(
        eq(seatHolds.showtimeId, showtimeId),
        eq(seatHolds.userId, userId),
        gt(seatHolds.expiresAt, now),
      ),
    );
  if (alreadyMine + fresh.length > MAX_SEATS_PER_BOOKING) throw badRequest('too_many_seats');

  // Re-holding an own active hold returns it unchanged: extending it would let a hold live forever.
  // Inserts go in sorted seat order so two users holding the same seats in opposite order cannot
  // deadlock on the unique index.
  const expiresAt = new Date(now.getTime() + HOLD_TTL_MS);
  const inserted = fresh.length
    ? await tx
        .insert(seatHolds)
        .values([...fresh].sort().map((seatId) => ({ showtimeId, seatId, userId, expiresAt })))
        .returning()
    : [];

  const byInput = new Map([...active, ...inserted].map((h) => [h.seatId, h]));
  return {
    holds: seatIds.map((id) => toHold(byInput.get(id) as HoldRow)),
    changes: fresh.map((seatId) => ({ seatId, state: 'held' as const })),
  };
}

export async function activeHolds(
  db: Db,
  { showtimeId, userId, now }: { showtimeId: string; userId: string; now: Date },
): Promise<Hold[]> {
  const rows = await db
    .select()
    .from(seatHolds)
    .where(
      and(
        eq(seatHolds.showtimeId, showtimeId),
        eq(seatHolds.userId, userId),
        gt(seatHolds.expiresAt, now),
      ),
    );
  return rows.map(toHold);
}

/** Deletes the user's own hold. Returns the freed seat, or null when it is not theirs. */
export async function releaseHold(
  db: Db,
  { holdId, userId }: { holdId: string; userId: string },
): Promise<{ showtimeId: string; seatId: string } | null> {
  const [found] = await db
    .select({ showtimeId: seatHolds.showtimeId })
    .from(seatHolds)
    .where(and(eq(seatHolds.id, holdId), eq(seatHolds.userId, userId)))
    .limit(1);
  if (!found) return null;
  return db.transaction(async (tx) => {
    await lockUserShowtime(tx, userId, found.showtimeId);
    const [row] = await tx
      .select()
      .from(seatHolds)
      .where(and(eq(seatHolds.id, holdId), eq(seatHolds.userId, userId)))
      .for('update');
    if (!row) return null;
    // A hold that backs a booking is released by that booking's confirm, failure or expiry.
    if (row.bookingId) throw conflict('hold_in_booking');
    await tx.delete(seatHolds).where(eq(seatHolds.id, holdId));
    return { showtimeId: row.showtimeId, seatId: row.seatId };
  });
}
