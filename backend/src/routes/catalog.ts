import type { MovieDetail, SeatDelta, SeatMap } from '@open-cinema/shared';
import { ubDate, ubDayRange } from '@open-cinema/shared';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { branches, halls, movies, seats, showtimes } from '../db/schema';
import { notFound } from '../lib/errors';
import { validate } from '../lib/http';
import { heldCount, SLOT_COLUMNS, toBranch, toSlot, toSummary } from '../services/catalog-views';
import { nonFreeSeats } from '../services/seat-state';

const HEARTBEAT_MS = 20_000;
const UUID = z.string().uuid();

const MovieListQuery = z.object({ status: z.enum(['now', 'soon']).default('now') });
const ShowtimesQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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
    // Registered before the first await so a client dropping mid-query is still cleaned up.
    let closed = false;
    let cleanupFns: (() => void)[] = [];
    const cleanup = () => {
      closed = true;
      for (const fn of cleanupFns) fn();
      cleanupFns = [];
    };
    res.on('close', cleanup);
    const gone = () => closed || res.destroyed;

    const id = req.params.id;
    if (!UUID.safeParse(id).success) throw notFound();
    const [exists] = await db
      .select({ id: showtimes.id })
      .from(showtimes)
      .where(eq(showtimes.id, id))
      .limit(1);
    if (gone()) return;
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
    cleanupFns.push(unsubscribe, () => clearInterval(heartbeat));

    try {
      const taken = await nonFreeSeats(db, id, clock());
      if (gone()) return cleanup();
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
