import type { Hold, SeatDelta } from '@open-cinema/shared';
import { and, count, eq, gt, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { seatHolds, seats, showtimes, tickets } from '../db/schema';
import { AppError, badRequest, isUniqueViolation, notFound } from '../lib/errors';
import { nonFreeSeats } from './seat-state';

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
    if (!isUniqueViolation(err)) throw err;
    // The transaction is aborted; find out who beat us from a fresh read.
    const taken = await nonFreeSeats(db, input.showtimeId, input.now);
    const lost = seatIds.filter((id) => taken.has(id));
    throw new SeatTakenError(lost.length > 0 ? lost : seatIds);
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function holdInTransaction(
  tx: Tx,
  { showtimeId, seatIds, userId, now }: CreateHoldsInput,
): Promise<CreateHoldsResult> {
  const [show] = await tx
    .select({ status: showtimes.status, startsAt: showtimes.startsAt, hallId: showtimes.hallId })
    .from(showtimes)
    .where(eq(showtimes.id, showtimeId))
    .limit(1);
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

  const expiresAt = new Date(now.getTime() + HOLD_TTL_MS);
  const refreshed = mineHere.size
    ? await tx
        .update(seatHolds)
        .set({ expiresAt })
        .where(
          and(
            eq(seatHolds.showtimeId, showtimeId),
            eq(seatHolds.userId, userId),
            inArray(seatHolds.seatId, [...mineHere]),
          ),
        )
        .returning()
    : [];
  const inserted = fresh.length
    ? await tx
        .insert(seatHolds)
        .values(fresh.map((seatId) => ({ showtimeId, seatId, userId, expiresAt })))
        .returning()
    : [];

  const byInput = new Map([...refreshed, ...inserted].map((h) => [h.seatId, h]));
  return {
    holds: seatIds.map((id) => toHold(byInput.get(id) as HoldRow)),
    changes: inserted.map((h) => ({ seatId: h.seatId, state: 'held' as const })),
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
  const [row] = await db
    .delete(seatHolds)
    .where(and(eq(seatHolds.id, holdId), eq(seatHolds.userId, userId)))
    .returning();
  return row ? { showtimeId: row.showtimeId, seatId: row.seatId } : null;
}
