import { asc, desc, eq, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { bookings, branches, halls, movies, seats, showtimes, tickets } from '../db/schema';
import { env } from '../env';
import { checkCode, signPassUrl } from '../lib/sign';
import type { TicketView } from '../shared';
import { walletConfig } from '../wallet/pass';
import { toBranch, toSummary } from './catalog-views';

export type TicketScope = 'upcoming' | 'past';

/**
 * Tickets matching `where`, as the API shows them. `passUrl` is an absolute, short-lived link and
 * stays null while Wallet is not configured. Cancelled tickets are included with their status.
 */
export async function ticketViews(
  db: Db,
  where: SQL,
  now: Date,
  order: 'asc' | 'desc' = 'asc',
): Promise<TicketView[]> {
  const dir = order === 'asc' ? asc : desc;
  const rows = await db
    .select({
      ticket: tickets,
      orderNo: bookings.orderNo,
      seat: seats,
      hallName: halls.name,
      show: showtimes,
      movie: movies,
      branch: branches,
    })
    .from(tickets)
    .innerJoin(bookings, eq(bookings.id, tickets.bookingId))
    .innerJoin(seats, eq(seats.id, tickets.seatId))
    .innerJoin(showtimes, eq(showtimes.id, tickets.showtimeId))
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .innerJoin(branches, eq(branches.id, halls.branchId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .where(where)
    .orderBy(
      dir(showtimes.startsAt),
      asc(bookings.orderNo),
      asc(seats.rowLabel),
      asc(seats.number),
    );
  const wallet = walletConfig() !== null;
  return rows.map((r) => ({
    id: r.ticket.id,
    bookingId: r.ticket.bookingId,
    orderNo: r.orderNo,
    status: r.ticket.status,
    usedAt: r.ticket.usedAt?.toISOString() ?? null,
    seat: { rowLabel: r.seat.rowLabel, number: r.seat.number, kind: r.seat.kind },
    hallName: r.hallName,
    showtime: { id: r.show.id, startsAt: r.show.startsAt.toISOString(), format: r.show.format },
    movie: toSummary(r.movie),
    branch: toBranch(r.branch),
    qrToken: r.ticket.qrToken,
    checkCode: checkCode(r.ticket.id),
    passUrl:
      wallet && r.ticket.status === 'valid'
        ? `${env.API_PUBLIC_URL}${signPassUrl(r.ticket.id, now)}`
        : null,
  }));
}

/** The user's paid and cancelled tickets. Upcoming = the film has not finished yet. */
export function myTickets(db: Db, userId: string, scope: TicketScope, now: Date) {
  const ends = sql`${showtimes.startsAt} + make_interval(mins => ${movies.durationMin})`;
  const when =
    scope === 'upcoming'
      ? sql`${ends} > ${now.toISOString()}::timestamptz`
      : sql`${ends} <= ${now.toISOString()}::timestamptz`;
  return ticketViews(
    db,
    sql`${eq(bookings.userId, userId)} and ${bookings.status} in ('paid', 'cancelled') and ${when}`,
    now,
    scope === 'upcoming' ? 'asc' : 'desc',
  );
}
