import { AdminShowtimeBody, AdminShowtimeListQuery, AdminShowtimePatch } from '@open-cinema/shared';
import { Router } from 'express';
import type { z } from 'zod';
import type { AppDeps } from '../../app';
import { notFound } from '../../lib/errors';
import { uuidParam, validate } from '../../lib/http';
import {
  cancelShowtime,
  createShowtime,
  listShowtimes,
  updateShowtime,
} from '../../services/showtimes';

export function createAdminShowtimesRouter(deps: AppDeps): Router {
  const { db } = deps;
  const r = Router();

  const one = async (id: string) => {
    const [row] = await listShowtimes(db, { id });
    if (!row) throw notFound();
    return row;
  };

  r.get('/showtimes', validate(AdminShowtimeListQuery, 'query'), async (_req, res) => {
    res.json(await listShowtimes(db, res.locals.query as z.infer<typeof AdminShowtimeListQuery>));
  });

  r.get('/showtimes/:id', async (req, res) => {
    res.json(await one(uuidParam(req)));
  });

  r.post('/showtimes', validate(AdminShowtimeBody), async (req, res) => {
    res.status(201).json(await one(await createShowtime(db, req.body)));
  });

  r.patch('/showtimes/:id', validate(AdminShowtimePatch), async (req, res) => {
    const id = uuidParam(req);
    await updateShowtime(db, id, req.body);
    res.json(await one(id));
  });

  r.post('/showtimes/:id/cancel', async (req, res) => {
    res.json(await cancelShowtime(db, deps, uuidParam(req)));
  });

  return r;
}
