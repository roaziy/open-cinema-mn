import { AdminShowtimeBody, AdminShowtimeListQuery, AdminShowtimePatch } from '@open-cinema/shared';
import { Router } from 'express';
import type { z } from 'zod';
import type { AppDeps } from '../../app';
import { notFound } from '../../lib/errors';
import { uuidParam, validate } from '../../lib/http';
import {
  beginCancellation,
  createShowtime,
  listShowtimes,
  previewCancel,
  updateShowtime,
} from '../../services/showtimes';

export function createAdminShowtimesRouter(deps: AppDeps): Router {
  const { db } = deps;
  const r = Router();

  const one = async (id: string) => {
    const [row] = (await listShowtimes(db, { id })).items;
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
    res.status(201).json(await one(await createShowtime(db, req.body, deps.clock())));
  });

  r.patch('/showtimes/:id', validate(AdminShowtimePatch), async (req, res) => {
    const id = uuidParam(req);
    await updateShowtime(db, id, req.body, deps.clock());
    res.json(await one(id));
  });

  r.get('/showtimes/:id/cancel-preview', async (req, res) => {
    res.json(await previewCancel(db, uuidParam(req), deps.clock()));
  });

  r.post('/showtimes/:id/cancel', async (req, res) => {
    const { result, settle } = await beginCancellation(db, deps, uuidParam(req));
    res.json(result);
    // Refunds and emails run after the answer: with a slow provider they would outlast the admin
    // web's request timeout. The `refundOwed` drain guard and the sweeper remain the safety net.
    void settle();
  });

  return r;
}
