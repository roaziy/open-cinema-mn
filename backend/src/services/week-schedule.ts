import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { halls, movies, showtimes } from '../db/schema';
import { AppError } from '../lib/errors';
import { addDays, ubDate, ubDayRange } from '../shared';
import { PREMIUM_EXTRA, planDay, priceFor } from './schedule';
import { createShowtime } from './showtimes';

const MIN_MS = 60_000;

export type WeekResult = {
  created: number;
  /** Hall-days left alone because they already had showings. */
  keptDays: number;
  /** Planned slots not created: already started, or the hall was busy. */
  skippedSlots: number;
};

/** Showing format from the hall's name: IMAX halls show IMAX, 3D halls 3D, the rest 2D. */
export function formatForHall(name: string): '2D' | '3D' | 'IMAX' {
  if (/imax/i.test(name)) return 'IMAX';
  if (/3d/i.test(name)) return '3D';
  return '2D';
}

/**
 * Schedules the films now showing across the halls for `days` days from `from` (UB dates), the
 * same plan the demo seed uses: 10:00 to 23:30, films rotating by hall and day. A hall-day that
 * already has any showing is left exactly as it is, so running this again only fills the gaps.
 * Every showing goes through `createShowtime`, so overlap and past-time rules still hold.
 */
export async function scheduleWeek(
  db: Db,
  o: { now: Date; from?: string; days?: number; branchIds?: string[] },
): Promise<WeekResult> {
  const films = await db
    .select({ id: movies.id, durationMin: movies.durationMin })
    .from(movies)
    .where(eq(movies.status, 'now'))
    .orderBy(desc(movies.releaseDate), asc(movies.title));
  if (films.length === 0) throw new Error('no films are showing now: run movies:update first');

  const hallRows = await db
    .select({ id: halls.id, name: halls.name })
    .from(halls)
    .where(o.branchIds ? inArray(halls.branchId, o.branchIds) : undefined)
    .orderBy(asc(halls.branchId), asc(halls.name));
  if (hallRows.length === 0) throw new Error('no halls: create them first (halls:create)');

  const from = o.from ?? ubDate(o.now);
  const result: WeekResult = { created: 0, keptDays: 0, skippedSlots: 0 };
  for (let d = 0; d < (o.days ?? 7); d++) {
    const date = addDays(from, d);
    const day = ubDayRange(date);
    for (const [hi, hall] of hallRows.entries()) {
      const [taken] = await db
        .select({ id: showtimes.id })
        .from(showtimes)
        .where(
          and(
            eq(showtimes.hallId, hall.id),
            eq(showtimes.status, 'scheduled'),
            gte(showtimes.startsAt, day.start),
            lt(showtimes.startsAt, day.end),
          ),
        )
        .limit(1);
      if (taken) {
        result.keptDays++;
        continue;
      }
      const format = formatForHall(hall.name);
      for (const { film, startMin } of planDay(hi, d, films)) {
        const startsAt = new Date(day.start.getTime() + startMin * MIN_MS);
        if (startsAt <= o.now) {
          result.skippedSlots++;
          continue;
        }
        const priceStandard = priceFor(date, startMin, format === 'IMAX');
        try {
          await createShowtime(
            db,
            {
              movieId: film.id,
              hallId: hall.id,
              startsAt: startsAt.toISOString(),
              format,
              priceStandard,
              pricePremium: priceStandard + PREMIUM_EXTRA,
            },
            o.now,
          );
          result.created++;
        } catch (err) {
          if (err instanceof AppError && err.code === 'hall_busy') result.skippedSlots++;
          else throw err;
        }
      }
    }
  }
  return result;
}
