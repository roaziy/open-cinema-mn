import type {
  Branch,
  MovieDetail,
  MovieSummary,
  SeatDelta,
  SeatMap,
  ShowtimeSlot,
} from '@open-cinema/shared';
import { ubDate, ubDayRange } from '@open-cinema/shared';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import type { Db } from '../db/client';
import { branches, halls, movies, seatHolds, seats, showtimes, tickets } from '../db/schema';
import { notFound } from '../lib/errors';
import { validate } from '../lib/http';

const HEARTBEAT_MS = 20_000;
const UUID = z.string().uuid();

const MovieListQuery = z.object({ status: z.enum(['now', 'soon']).default('now') });
const ShowtimesQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

type MovieRow = typeof movies.$inferSelect;
type BranchRow = typeof branches.$inferSelect;

const toSummary = (m: MovieRow): MovieSummary => ({
  id: m.id,
  title: m.title,
  posterUrl: m.posterUrl,
  backdropUrl: m.backdropUrl,
  tone: m.tone,
  ageRating: m.ageRating,
  durationMin: m.durationMin,
  genres: m.genres,
  // archived films are never returned by the public routes
  status: m.status === 'soon' ? 'soon' : 'now',
  releaseDate: m.releaseDate,
});

const toBranch = (b: BranchRow): Branch => ({
  id: b.id,
  name: b.name,
  address: b.address,
  lat: b.lat,
  lng: b.lng,
});

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

const SLOT_COLUMNS = {
  id: showtimes.id,
  startsAt: showtimes.startsAt,
  format: showtimes.format,
  priceStandard: showtimes.priceStandard,
  pricePremium: showtimes.pricePremium,
  hallName: halls.name,
  capacity: sql<number>`(select count(*)::int from ${seats} where ${seats.hallId} = ${halls.id} and ${seats.kind} <> 'blocked')`,
  sold: sql<number>`(select count(*)::int from ${tickets} where ${tickets.showtimeId} = ${showtimes.id} and ${tickets.status} = 'valid')`,
};

function heldCount(now: Date) {
  return sql<number>`(select count(*)::int from ${seatHolds} where ${seatHolds.showtimeId} = ${showtimes.id} and ${seatHolds.expiresAt} > ${now.toISOString()}::timestamptz and not exists (select 1 from ${tickets} where ${tickets.showtimeId} = ${seatHolds.showtimeId} and ${tickets.seatId} = ${seatHolds.seatId} and ${tickets.status} = 'valid'))`;
}

type SlotRow = {
  id: string;
  startsAt: Date;
  format: ShowtimeSlot['format'];
  priceStandard: number;
  pricePremium: number;
  hallName: string;
  capacity: number;
  sold: number;
  held: number;
};

const toSlot = (r: SlotRow): ShowtimeSlot => ({
  id: r.id,
  startsAt: r.startsAt.toISOString(),
  format: r.format,
  priceStandard: r.priceStandard,
  pricePremium: r.pricePremium,
  seatsLeft: Math.max(0, r.capacity - r.sold - r.held),
  capacity: r.capacity,
  hallName: r.hallName,
});

function sseWrite(res: import('express').Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createCatalogRouter(deps: AppDeps): Router {
  const { db, clock, seatHub } = deps;
  const r = Router();

  r.get('/branches', async (_req, res) => {
    const rows = await db.select().from(branches).orderBy(asc(branches.name));
    res.json(rows.map(toBranch));
  });

  r.get('/movies', validate(MovieListQuery, 'query'), async (_req, res) => {
    const { status } = res.locals.query as z.infer<typeof MovieListQuery>;
    const rows = await db
      .select()
      .from(movies)
      .where(eq(movies.status, status))
      .orderBy(status === 'now' ? desc(movies.releaseDate) : asc(movies.releaseDate));
    res.json(rows.map(toSummary));
  });

  const findMovie = async (id: string) => {
    if (!UUID.safeParse(id).success) throw notFound();
    const [m] = await db.select().from(movies).where(eq(movies.id, id)).limit(1);
    if (!m || m.status === 'archived') throw notFound();
    return m;
  };

  r.get('/movies/:id', async (req, res) => {
    const m = await findMovie(req.params.id);
    const detail: MovieDetail = { ...toSummary(m), synopsis: m.synopsis, trailerUrl: m.trailerUrl };
    res.json(detail);
  });

  r.get('/movies/:id/showtimes', validate(ShowtimesQuery, 'query'), async (req, res) => {
    const m = await findMovie(String(req.params.id));
    const now = clock();
    const { date } = res.locals.query as z.infer<typeof ShowtimesQuery>;
    const { start, end } = ubDayRange(date ?? ubDate(now));
    const rows = await db
      .select({
        ...SLOT_COLUMNS,
        held: heldCount(now),
        branchId: branches.id,
      })
      .from(showtimes)
      .innerJoin(halls, eq(halls.id, showtimes.hallId))
      .innerJoin(branches, eq(branches.id, halls.branchId))
      .where(
        and(
          eq(showtimes.movieId, m.id),
          eq(showtimes.status, 'scheduled'),
          gt(showtimes.startsAt, now),
          sql`${showtimes.startsAt} >= ${start.toISOString()}::timestamptz`,
          sql`${showtimes.startsAt} < ${end.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(asc(showtimes.startsAt));
    const branchIds = [...new Set(rows.map((x) => x.branchId))];
    const branchRows = branchIds.length
      ? await db.select().from(branches).where(inArray(branches.id, branchIds))
      : [];
    branchRows.sort((a, b) => a.name.localeCompare(b.name));
    res.json(
      branchRows.map((b) => ({
        branch: toBranch(b),
        showtimes: rows.filter((x) => x.branchId === b.id).map(toSlot),
      })),
    );
  });

  const loadShowtime = async (id: string) => {
    if (!UUID.safeParse(id).success) throw notFound();
    const now = clock();
    const [row] = await db
      .select({
        ...SLOT_COLUMNS,
        held: heldCount(now),
        status: showtimes.status,
        hallId: halls.id,
        screenWidthM: halls.screenWidthM,
        screenHeightM: halls.screenHeightM,
        screenXM: halls.screenXM,
        movie: movies,
        branch: branches,
      })
      .from(showtimes)
      .innerJoin(halls, eq(halls.id, showtimes.hallId))
      .innerJoin(branches, eq(branches.id, halls.branchId))
      .innerJoin(movies, eq(movies.id, showtimes.movieId))
      .where(eq(showtimes.id, id))
      .limit(1);
    if (!row) throw notFound();
    return { row, now };
  };

  r.get('/showtimes/:id', async (req, res) => {
    const { row, now } = await loadShowtime(req.params.id);
    const [seatRows, taken] = await Promise.all([
      db
        .select()
        .from(seats)
        .where(eq(seats.hallId, row.hallId))
        .orderBy(asc(seats.rowLabel), asc(seats.number)),
      nonFreeSeats(db, row.id, now),
    ]);
    const body: SeatMap = {
      showtime: {
        ...toSlot(row),
        movie: toSummary(row.movie),
        branch: toBranch(row.branch),
        status: row.status,
      },
      hall: {
        id: row.hallId,
        name: row.hallName,
        screen_width_m: row.screenWidthM,
        screen_height_m: row.screenHeightM,
        screen_x_m: row.screenXM,
      },
      seats: seatRows.map((s) => ({
        id: s.id,
        rowLabel: s.rowLabel,
        number: s.number,
        x_m: s.xM,
        y_m: s.yM,
        z_m: s.zM,
        kind: s.kind,
        state: taken.get(s.id) ?? 'free',
      })),
    };
    res.json(body);
  });

  r.get('/showtimes/:id/seats/stream', async (req, res) => {
    const id = req.params.id;
    if (!UUID.safeParse(id).success) throw notFound();
    const [exists] = await db
      .select({ id: showtimes.id })
      .from(showtimes)
      .where(eq(showtimes.id, id))
      .limit(1);
    if (!exists) throw notFound();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    // Subscribe before reading the snapshot so a change in between is queued, not lost.
    let ready = false;
    const queued: SeatDelta[][] = [];
    const unsubscribe = seatHub.subscribe(id, (changes) => {
      if (ready) sseWrite(res, 'delta', { changes });
      else queued.push(changes);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', cleanup);

    try {
      const taken = await nonFreeSeats(db, id, clock());
      if (closed) return;
      sseWrite(res, 'snapshot', {
        seats: [...taken].map(([seatId, state]) => ({ seatId, state })),
      });
      ready = true;
      for (const changes of queued) sseWrite(res, 'delta', { changes });
    } catch (err) {
      cleanup();
      res.end();
      console.error(err);
    }
  });

  return r;
}
