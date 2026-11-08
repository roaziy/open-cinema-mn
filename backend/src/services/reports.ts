import type { AdminDashboard, AdminReport } from '@open-cinema/shared';
import { ubDate, ubDayRange } from '@open-cinema/shared';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { bookings, branches, halls, movies, payments, showtimes } from '../db/schema';
import { SLOT_COLUMNS } from './catalog-views';

const DAY_MS = 24 * 60 * 60 * 1000;
const UB_OFFSET_MS = 8 * 60 * 60 * 1000;
const UPCOMING = 8;
const TOP_FILMS = 5;

const ratio = (sold: number, capacity: number) =>
  capacity > 0 ? Math.round((sold / capacity) * 10_000) / 10_000 : 0;

type Acc = { revenue: number; tickets: number; sold: number; capacity: number };
const acc = (): Acc => ({ revenue: 0, tickets: 0, sold: 0, capacity: 0 });

/** Revenue = paid bookings only; tickets = valid (including used) ones. Cancelled showings are out. */
async function showtimeFacts(db: Db, from: Date, to: Date, branchId?: string) {
  return db
    .select({
      id: showtimes.id,
      startsAt: showtimes.startsAt,
      movieId: movies.id,
      title: movies.title,
      hallId: halls.id,
      hallName: halls.name,
      branchName: branches.name,
      capacity: SLOT_COLUMNS.capacity,
      sold: SLOT_COLUMNS.sold,
      revenue: sql<number>`(select coalesce(sum(${bookings.total}), 0)::int from ${bookings} where ${bookings.showtimeId} = ${showtimes.id} and ${bookings.status} = 'paid')`,
    })
    .from(showtimes)
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .innerJoin(branches, eq(branches.id, halls.branchId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .where(
      and(
        eq(showtimes.status, 'scheduled'),
        gte(showtimes.startsAt, from),
        lt(showtimes.startsAt, to),
        branchId ? eq(halls.branchId, branchId) : undefined,
      ),
    );
}

/**
 * Box-office report over a range of Ulaanbaatar dates. Everything is attributed to the day the
 * showing starts, so revenue, tickets and occupancy describe the same set of showings.
 */
export async function buildReport(
  db: Db,
  q: { from: string; to: string; branchId?: string },
): Promise<AdminReport> {
  const start = ubDayRange(q.from).start;
  const end = ubDayRange(q.to).end;
  const facts = await showtimeFacts(db, start, end, q.branchId);

  const total = acc();
  const days = new Map<string, Acc>();
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS)
    days.set(ubDate(new Date(t)), acc());
  const movieRows = new Map<string, Acc & { title: string }>();
  const hallRows = new Map<string, Acc & { hallName: string; branchName: string }>();

  const add = (a: Acc, f: { revenue: number; sold: number; capacity: number }) => {
    a.revenue += f.revenue;
    a.tickets += f.sold;
    a.sold += f.sold;
    a.capacity += f.capacity;
  };
  for (const f of facts) {
    add(total, f);
    add(days.get(ubDate(f.startsAt)) ?? acc(), f);
    const m = movieRows.get(f.movieId) ?? { ...acc(), title: f.title };
    add(m, f);
    movieRows.set(f.movieId, m);
    const h = hallRows.get(f.hallId) ?? {
      ...acc(),
      hallName: f.hallName,
      branchName: f.branchName,
    };
    add(h, f);
    hallRows.set(f.hallId, h);
  }
  const out = (a: Acc) => ({
    revenue: a.revenue,
    tickets: a.tickets,
    occupancy: ratio(a.sold, a.capacity),
  });
  return {
    totals: out(total),
    byDay: [...days].map(([date, a]) => ({ date, ...out(a) })),
    byMovie: [...movieRows]
      .map(([movieId, a]) => ({ movieId, title: a.title, ...out(a) }))
      .sort((a, b) => b.revenue - a.revenue || a.title.localeCompare(b.title)),
    byHall: [...hallRows]
      .map(([hallId, a]) => ({ hallId, hallName: a.hallName, branchName: a.branchName, ...out(a) }))
      .sort(
        (a, b) => a.branchName.localeCompare(b.branchName) || a.hallName.localeCompare(b.hallName),
      ),
  };
}

/** Today against yesterday (sales by payment time), plus what is coming up. All days are UB days. */
export async function buildDashboard(
  db: Db,
  now: Date,
  branchId?: string,
): Promise<AdminDashboard> {
  const today = ubDayRange(ubDate(now));
  const yesterday = { start: new Date(today.start.getTime() - DAY_MS), end: today.start };
  const inBranch = branchId ? eq(halls.branchId, branchId) : undefined;

  const salesRows = await db
    .select({
      total: bookings.total,
      paidAt: bookings.paidAt,
      tickets: sql<number>`cardinality(${bookings.seatIds})::int`,
      movieId: movies.id,
      title: movies.title,
      posterUrl: movies.posterUrl,
      tone: movies.tone,
    })
    .from(bookings)
    .innerJoin(showtimes, eq(showtimes.id, bookings.showtimeId))
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .where(
      and(
        eq(bookings.status, 'paid'),
        gte(bookings.paidAt, yesterday.start),
        lt(bookings.paidAt, today.end),
        inBranch,
      ),
    );
  // paid_at is set whenever a booking turns paid; the filter above already excludes null.
  const sales = salesRows.flatMap((r) => (r.paidAt ? [{ ...r, paidAt: r.paidAt }] : []));

  const day = (r: { start: Date; end: Date }) => {
    const mine = sales.filter((s) => s.paidAt >= r.start && s.paidAt < r.end);
    return {
      mine,
      revenue: mine.reduce((n, s) => n + s.total, 0),
      tickets: mine.reduce((n, s) => n + s.tickets, 0),
    };
  };
  const t = day(today);
  const y = day(yesterday);

  const facts = await showtimeFacts(db, yesterday.start, today.end, branchId);
  const occupancy = (r: { start: Date; end: Date }) => {
    const slots = facts.filter((f) => f.startsAt >= r.start && f.startsAt < r.end);
    return ratio(
      slots.reduce((n, f) => n + f.sold, 0),
      slots.reduce((n, f) => n + f.capacity, 0),
    );
  };

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0, tickets: 0 }));
  for (const s of t.mine) {
    const hour = new Date(s.paidAt.getTime() + UB_OFFSET_MS).getUTCHours();
    const slot = hourly[hour];
    if (slot) {
      slot.revenue += s.total;
      slot.tickets += s.tickets;
    }
  }

  const films = new Map<
    string,
    {
      movieId: string;
      title: string;
      posterUrl: string;
      tone: string;
      revenue: number;
      tickets: number;
    }
  >();
  for (const s of t.mine) {
    const f = films.get(s.movieId) ?? {
      movieId: s.movieId,
      title: s.title,
      posterUrl: s.posterUrl,
      tone: s.tone,
      revenue: 0,
      tickets: 0,
    };
    f.revenue += s.total;
    f.tickets += s.tickets;
    films.set(s.movieId, f);
  }

  const [refunds] = await db
    .select({
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${payments.amount}), 0)::int`,
    })
    .from(payments)
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .innerJoin(showtimes, eq(showtimes.id, bookings.showtimeId))
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .where(
      and(
        eq(payments.status, 'refunded'),
        gte(payments.refundedAt, today.start),
        lt(payments.refundedAt, today.end),
        inBranch,
      ),
    );

  const upcoming = await db
    .select({
      id: showtimes.id,
      startsAt: showtimes.startsAt,
      movieTitle: movies.title,
      hallName: SLOT_COLUMNS.hallName,
      branchName: branches.name,
      sold: SLOT_COLUMNS.sold,
      capacity: SLOT_COLUMNS.capacity,
    })
    .from(showtimes)
    .innerJoin(halls, eq(halls.id, showtimes.hallId))
    .innerJoin(branches, eq(branches.id, halls.branchId))
    .innerJoin(movies, eq(movies.id, showtimes.movieId))
    .where(and(eq(showtimes.status, 'scheduled'), gte(showtimes.startsAt, now), inBranch))
    .orderBy(asc(showtimes.startsAt), desc(showtimes.createdAt))
    .limit(UPCOMING);

  return {
    today: { revenue: t.revenue, tickets: t.tickets, occupancy: occupancy(today) },
    yesterday: { revenue: y.revenue, tickets: y.tickets, occupancy: occupancy(yesterday) },
    refundsToday: { count: refunds?.count ?? 0, amount: refunds?.amount ?? 0 },
    hourlySales: hourly,
    topFilms: [...films.values()]
      .sort((a, b) => b.revenue - a.revenue || a.title.localeCompare(b.title))
      .slice(0, TOP_FILMS),
    upcoming: upcoming.map((u) => ({ ...u, startsAt: u.startsAt.toISOString() })),
  };
}
