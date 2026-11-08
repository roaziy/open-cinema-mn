import type {
  AdminShowtime,
  AdminShowtimeBody,
  AdminShowtimeListQuery,
  AdminShowtimePatch,
  ShowtimeCancelResult,
} from '@open-cinema/shared';
import { ubDayRange } from '@open-cinema/shared';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { AppDeps } from '../app';
import type { Db } from '../db/client';
import {
  bookings,
  branches,
  halls,
  movies,
  seatHolds,
  showtimes,
  tickets,
  users,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { showtimeCancelledEmail } from '../messages/templates';
import { refundOwed } from './bookings';
import { SLOT_COLUMNS } from './catalog-views';
import type { Tx } from './holds';

/** Cleaning time kept free between two showings in one hall. */
export const CLEANING_GAP_MIN = 15;
const MIN_MS = 60_000;
const SHOWTIME_LIST_CAP = 500;

const REFUND_NOTE = 'Таны төлбөр буцаагдана.';

type Deps = Pick<AppDeps, 'messages' | 'payments' | 'seatHub' | 'clock'>;

const lockHall = (tx: Tx, hallId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`hall:${hallId}`}))`);

/** 409 `hall_busy` when another scheduled showing (plus cleaning gap) collides with the slot. */
async function assertHallFree(
  tx: Tx,
  a: { hallId: string; startsAt: Date; durationMin: number; excludeId?: string },
): Promise<void> {
  const end = new Date(a.startsAt.getTime() + a.durationMin * MIN_MS);
  const gap = CLEANING_GAP_MIN;
  const clash = await tx
    .select({ id: showtimes.id })
    .from(showtimes)
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .where(
      and(
        eq(showtimes.hallId, a.hallId),
        eq(showtimes.status, 'scheduled'),
        a.excludeId ? sql`${showtimes.id} <> ${a.excludeId}` : undefined,
        sql`${showtimes.startsAt} < ${new Date(end.getTime() + gap * MIN_MS).toISOString()}::timestamptz`,
        sql`${showtimes.startsAt} + (${movies.durationMin} + ${gap}) * interval '1 minute' > ${a.startsAt.toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  if (clash.length > 0) throw conflict('hall_busy');
}

async function durationOf(tx: Tx, movieId: string): Promise<number> {
  const [m] = await tx
    .select({ durationMin: movies.durationMin })
    .from(movies)
    .where(eq(movies.id, movieId))
    .limit(1);
  if (!m) throw notFound('movie_not_found');
  return m.durationMin;
}

async function assertHallExists(tx: Tx, hallId: string): Promise<void> {
  const [h] = await tx.select({ id: halls.id }).from(halls).where(eq(halls.id, hallId)).limit(1);
  if (!h) throw notFound('hall_not_found');
}

export async function createShowtime(db: Db, body: AdminShowtimeBody, now: Date): Promise<string> {
  const startsAt = new Date(body.startsAt);
  if (startsAt <= now) throw badRequest('showtime_in_past');
  return db.transaction(async (tx) => {
    await assertHallExists(tx, body.hallId);
    const durationMin = await durationOf(tx, body.movieId);
    await lockHall(tx, body.hallId);
    await assertHallFree(tx, { hallId: body.hallId, startsAt, durationMin });
    const [row] = await tx
      .insert(showtimes)
      .values({
        movieId: body.movieId,
        hallId: body.hallId,
        startsAt,
        format: body.format,
        priceStandard: body.priceStandard,
        pricePremium: body.pricePremium,
      })
      .returning({ id: showtimes.id });
    return (row as { id: string }).id;
  });
}

/**
 * Prices may change any time (existing bookings keep what they paid). Moving the showing,
 * switching its hall, film or format is refused once anything is committed to it: a valid
 * ticket, an unexpired hold or a pending booking.
 */
export async function updateShowtime(
  db: Db,
  id: string,
  patch: AdminShowtimePatch,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    // NO KEY UPDATE conflicts with the FOR SHARE that holds and bookings take, but not with the
    // key-share lock a ticket insert takes through its foreign key, so it cannot deadlock confirm.
    const [cur] = await tx
      .select()
      .from(showtimes)
      .where(eq(showtimes.id, id))
      .for('no key update');
    if (!cur) throw notFound();
    if (cur.status === 'cancelled') throw conflict('showtime_cancelled');

    const next = {
      movieId: patch.movieId ?? cur.movieId,
      hallId: patch.hallId ?? cur.hallId,
      startsAt: patch.startsAt ? new Date(patch.startsAt) : cur.startsAt,
      format: patch.format ?? cur.format,
    };
    const moved =
      next.movieId !== cur.movieId ||
      next.hallId !== cur.hallId ||
      next.startsAt.getTime() !== cur.startsAt.getTime() ||
      next.format !== cur.format;

    if (moved) {
      if (next.startsAt.getTime() !== cur.startsAt.getTime() && next.startsAt <= now) {
        throw badRequest('showtime_in_past');
      }
      const [sold] = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(eq(tickets.showtimeId, id), eq(tickets.status, 'valid')))
        .limit(1);
      const [held] = await tx
        .select({ id: seatHolds.id })
        .from(seatHolds)
        .where(and(eq(seatHolds.showtimeId, id), gt(seatHolds.expiresAt, now)))
        .limit(1);
      const [pending] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.showtimeId, id), eq(bookings.status, 'pending')))
        .limit(1);
      if (sold || held || pending) throw conflict('showtime_locked');
      await assertHallExists(tx, next.hallId);
      const durationMin = await durationOf(tx, next.movieId);
      await lockHall(tx, next.hallId);
      await assertHallFree(tx, {
        hallId: next.hallId,
        startsAt: next.startsAt,
        durationMin,
        excludeId: id,
      });
    }
    await tx
      .update(showtimes)
      .set({
        ...next,
        priceStandard: patch.priceStandard ?? cur.priceStandard,
        pricePremium: patch.pricePremium ?? cur.pricePremium,
      })
      .where(eq(showtimes.id, id));
  });
}

export async function listShowtimes(
  db: Db,
  q: AdminShowtimeListQuery & { id?: string },
): Promise<{ items: AdminShowtime[]; truncated: boolean }> {
  const rows = await db
    .select({
      id: showtimes.id,
      movieId: movies.id,
      movieTitle: movies.title,
      durationMin: movies.durationMin,
      hallId: halls.id,
      hallName: SLOT_COLUMNS.hallName,
      branchId: branches.id,
      branchName: branches.name,
      startsAt: showtimes.startsAt,
      format: showtimes.format,
      priceStandard: showtimes.priceStandard,
      pricePremium: showtimes.pricePremium,
      status: showtimes.status,
      sold: SLOT_COLUMNS.sold,
      capacity: SLOT_COLUMNS.capacity,
    })
    .from(showtimes)
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .innerJoin(branches, eq(branches.id, halls.branchId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .where(
      and(
        q.id ? eq(showtimes.id, q.id) : undefined,
        q.branchId ? eq(halls.branchId, q.branchId) : undefined,
        q.hallId ? eq(showtimes.hallId, q.hallId) : undefined,
        q.movieId ? eq(showtimes.movieId, q.movieId) : undefined,
        q.from
          ? sql`${showtimes.startsAt} >= ${ubDayRange(q.from).start.toISOString()}::timestamptz`
          : undefined,
        q.to
          ? sql`${showtimes.startsAt} < ${ubDayRange(q.to).end.toISOString()}::timestamptz`
          : undefined,
      ),
    )
    .orderBy(asc(showtimes.startsAt), asc(halls.name))
    .limit(SHOWTIME_LIST_CAP + 1);
  const items = rows.slice(0, SHOWTIME_LIST_CAP).map(({ durationMin, startsAt, ...r }) => ({
    ...r,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + durationMin * MIN_MS).toISOString(),
  }));
  return { items, truncated: rows.length > SHOWTIME_LIST_CAP };
}

type Cancelled = { bookingIds: string[]; seatIds: string[]; ticketCount: number };

/**
 * Cancels a showing (spec 8.7). One transaction cancels the showing, its valid tickets and paid
 * bookings, drops its holds and expires pending bookings. After the commit each paid booking is
 * refunded through the durable path (provider call outside any transaction; the sweeper retries
 * failures), seats are published as free and customers are emailed. Cancelling twice is a no-op.
 */
export async function cancelShowtime(
  db: Db,
  deps: Deps,
  showtimeId: string,
): Promise<ShowtimeCancelResult> {
  const done = await db.transaction(async (tx): Promise<Cancelled | null> => {
    const [show] = await tx
      .select({ status: showtimes.status, startsAt: showtimes.startsAt })
      .from(showtimes)
      .where(eq(showtimes.id, showtimeId))
      .for('no key update');
    if (!show) throw notFound();
    if (show.status === 'cancelled') return null;
    if (show.startsAt <= deps.clock()) throw conflict('showtime_started');
    await tx.update(showtimes).set({ status: 'cancelled' }).where(eq(showtimes.id, showtimeId));

    // Lock every booking of the showing first: a confirm racing with us either finished before
    // (and is cancelled here) or waits, then finds its holds gone and refunds itself.
    const live = await tx
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(
        and(eq(bookings.showtimeId, showtimeId), inArray(bookings.status, ['pending', 'paid'])),
      )
      .orderBy(asc(bookings.id))
      .for('update');
    const paid = live.filter((b) => b.status === 'paid').map((b) => b.id);
    const pending = live.filter((b) => b.status === 'pending').map((b) => b.id);

    const cancelledTickets = await tx
      .update(tickets)
      .set({ status: 'cancelled' })
      .where(and(eq(tickets.showtimeId, showtimeId), eq(tickets.status, 'valid')))
      .returning({ seatId: tickets.seatId });
    if (paid.length > 0) {
      await tx.update(bookings).set({ status: 'cancelled' }).where(inArray(bookings.id, paid));
    }
    if (pending.length > 0) {
      await tx.update(bookings).set({ status: 'expired' }).where(inArray(bookings.id, pending));
    }
    const holds = await tx
      .delete(seatHolds)
      .where(eq(seatHolds.showtimeId, showtimeId))
      .returning({ seatId: seatHolds.seatId });
    return {
      bookingIds: paid,
      seatIds: [...new Set([...cancelledTickets, ...holds].map((r) => r.seatId))],
      ticketCount: cancelledTickets.length,
    };
  });

  if (!done)
    return { id: showtimeId, status: 'cancelled', cancelledBookings: 0, cancelledTickets: 0 };

  deps.seatHub.publish(
    showtimeId,
    done.seatIds.map((seatId) => ({ seatId, state: 'free' as const })),
  );
  for (const bookingId of done.bookingIds) {
    try {
      await refundOwed(db, bookingId, deps);
    } catch (err) {
      console.error('cancellation refund failed, will retry', err);
    }
    await sendCancellationEmail(db, deps, bookingId);
  }
  return {
    id: showtimeId,
    status: 'cancelled',
    cancelledBookings: done.bookingIds.length,
    cancelledTickets: done.ticketCount,
  };
}

/** Never throws: a failed email is logged and the refund path carries on. */
async function sendCancellationEmail(db: Db, deps: Deps, bookingId: string): Promise<void> {
  try {
    const [row] = await db
      .select({
        contactEmail: bookings.contactEmail,
        userEmail: users.email,
        verifiedAt: users.emailVerifiedAt,
        movieTitle: movies.title,
        branchName: branches.name,
        startsAt: showtimes.startsAt,
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.userId))
      .innerJoin(showtimes, eq(showtimes.id, bookings.showtimeId))
      .innerJoin(halls, eq(halls.id, showtimes.hallId))
      .innerJoin(branches, eq(branches.id, halls.branchId))
      .innerJoin(movies, eq(movies.id, showtimes.movieId))
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!row) return;
    const to = row.verifiedAt && row.userEmail ? row.userEmail : row.contactEmail;
    if (!to) return;
    const mail = showtimeCancelledEmail({
      movieTitle: row.movieTitle,
      branchName: row.branchName,
      startsAt: row.startsAt,
      refundNote: REFUND_NOTE,
    });
    await deps.messages.email({ to, ...mail });
  } catch (err) {
    console.error('showtime cancellation email failed', err);
  }
}
