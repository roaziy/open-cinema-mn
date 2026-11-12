import { and, desc, eq, gt } from 'drizzle-orm';
import { Router } from 'express';
import type { AppDeps } from '../../app';
import { movies, showtimes } from '../../db/schema';
import { conflict, isForeignKeyViolation, notFound } from '../../lib/errors';
import { uuidParam, validate } from '../../lib/http';
import { type AdminMovie, AdminMovieBody, AdminMoviePatch } from '../../shared';

const toAdminMovie = (m: typeof movies.$inferSelect): AdminMovie => ({
  id: m.id,
  title: m.title,
  synopsis: m.synopsis,
  durationMin: m.durationMin,
  ageRating: m.ageRating,
  genres: m.genres,
  posterUrl: m.posterUrl,
  backdropUrl: m.backdropUrl,
  trailerUrl: m.trailerUrl,
  tone: m.tone,
  releaseDate: m.releaseDate,
  status: m.status,
});

export function createAdminMoviesRouter({ db, clock }: AppDeps): Router {
  const r = Router();

  r.get('/movies', async (_req, res) => {
    const rows = await db.select().from(movies).orderBy(desc(movies.releaseDate), movies.title);
    res.json(rows.map(toAdminMovie));
  });

  r.get('/movies/:id', async (req, res) => {
    const [row] = await db
      .select()
      .from(movies)
      .where(eq(movies.id, uuidParam(req)));
    if (!row) throw notFound();
    res.json(toAdminMovie(row));
  });

  r.post('/movies', validate(AdminMovieBody), async (req, res) => {
    const [row] = await db.insert(movies).values(req.body).returning();
    res.status(201).json(toAdminMovie(row as typeof movies.$inferSelect));
  });

  r.patch('/movies/:id', validate(AdminMoviePatch), async (req, res) => {
    const id = uuidParam(req);
    const patch = req.body as Record<string, unknown>;
    if (typeof patch.durationMin === 'number') {
      // A different running time would shift the cleaning gaps of showings already on sale.
      const [cur] = await db
        .select({ durationMin: movies.durationMin })
        .from(movies)
        .where(eq(movies.id, id));
      if (cur && cur.durationMin !== patch.durationMin) {
        const [future] = await db
          .select({ id: showtimes.id })
          .from(showtimes)
          .where(
            and(
              eq(showtimes.movieId, id),
              eq(showtimes.status, 'scheduled'),
              gt(showtimes.startsAt, clock()),
            ),
          )
          .limit(1);
        if (future) throw conflict('movie_locked');
      }
    }
    const [row] =
      Object.keys(patch).length > 0
        ? await db.update(movies).set(patch).where(eq(movies.id, id)).returning()
        : await db.select().from(movies).where(eq(movies.id, id));
    if (!row) throw notFound();
    res.json(toAdminMovie(row));
  });

  r.delete('/movies/:id', async (req, res) => {
    try {
      const gone = await db
        .delete(movies)
        .where(eq(movies.id, uuidParam(req)))
        .returning({ id: movies.id });
      if (gone.length === 0) throw notFound();
    } catch (err) {
      // A film with showings is archived, not deleted.
      if (isForeignKeyViolation(err)) throw conflict('in_use');
      throw err;
    }
    res.status(204).end();
  });

  return r;
}
