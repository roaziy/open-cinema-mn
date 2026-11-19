import { and, eq, gt, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import type { Db } from '../db/client';
import { movies, showtimes } from '../db/schema';
import { sniffImage } from '../lib/sniff-image';
import { pickTone } from '../shared';
import type { StorageProvider } from '../storage';
import { downloadTmdbImage, type TmdbFilm } from './tmdb';

export type ImportResult = {
  created: number;
  updated: number;
  archived: number;
  skipped: string[];
};
type Download = (size: 'w780' | 'w1280', path: string) => Promise<Buffer>;

async function store(
  storage: StorageProvider,
  folder: 'posters' | 'backdrops',
  tmdbId: number,
  body: Buffer,
): Promise<string> {
  const kind = sniffImage(body);
  if (!kind) throw new Error('not a JPEG, PNG or WebP image');
  return storage.put(`${folder}/tmdb-${tmdbId}.${kind.ext}`, body, kind.contentType);
}

async function toneOf(poster: Buffer): Promise<string> {
  const { data } = await sharp(poster)
    .resize(48, 48, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return pickTone(data);
}

/**
 * Stores TMDB films: images into this server's storage, rows upserted by TMDB id (so running it
 * again updates instead of duplicating). Imported films that left the box office are archived,
 * unless a future showing still needs them. Films added in the admin (no TMDB id) are never
 * touched. A film whose images fail is skipped and reported, the rest still import.
 */
export async function importFilms(
  db: Db,
  storage: StorageProvider,
  films: TmdbFilm[],
  o: { now: Date; download?: Download },
): Promise<ImportResult> {
  const download = o.download ?? ((size, path) => downloadTmdbImage(size, path));
  const ids = films.map((f) => f.tmdbId);
  const known = new Set(
    ids.length
      ? (
          await db.select({ tmdbId: movies.tmdbId }).from(movies).where(inArray(movies.tmdbId, ids))
        ).map((r) => r.tmdbId)
      : [],
  );

  const result: ImportResult = { created: 0, updated: 0, archived: 0, skipped: [] };
  const imported: number[] = [];
  for (const f of films) {
    let posterUrl: string;
    let backdropUrl: string | null = null;
    let tone: string;
    try {
      const poster = await download('w780', f.posterPath);
      posterUrl = await store(storage, 'posters', f.tmdbId, poster);
      tone = await toneOf(poster);
      if (f.backdropPath) {
        backdropUrl = await store(
          storage,
          'backdrops',
          f.tmdbId,
          await download('w1280', f.backdropPath),
        );
      }
    } catch (err) {
      result.skipped.push(`${f.title} (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const values = {
      title: f.title,
      synopsis: f.synopsis,
      durationMin: f.durationMin,
      ageRating: f.ageRating,
      genres: f.genres,
      posterUrl,
      backdropUrl,
      trailerUrl: f.trailerUrl,
      tone,
      releaseDate: f.releaseDate,
      status: f.status,
    };
    await db
      .insert(movies)
      .values({ ...values, tmdbId: f.tmdbId })
      .onConflictDoUpdate({
        target: movies.tmdbId,
        targetWhere: sql`${movies.tmdbId} is not null`,
        set: values,
      });
    imported.push(f.tmdbId);
    if (known.has(f.tmdbId)) result.updated++;
    else result.created++;
  }

  // Only when this run reached TMDB at all: an empty list must not archive everything.
  if (imported.length > 0) {
    const gone = await db
      .update(movies)
      .set({ status: 'archived' })
      .where(
        and(
          isNotNull(movies.tmdbId),
          notInArray(movies.tmdbId, imported),
          inArray(movies.status, ['now', 'soon']),
          sql`not exists (${db
            .select({ one: sql`1` })
            .from(showtimes)
            .where(
              and(
                eq(showtimes.movieId, movies.id),
                eq(showtimes.status, 'scheduled'),
                gt(showtimes.startsAt, o.now),
              ),
            )})`,
        ),
      )
      .returning({ id: movies.id });
    result.archived = gone.length;
  }
  return result;
}
