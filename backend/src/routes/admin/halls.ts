import { eq } from 'drizzle-orm';
import { Router } from 'express';
import type { z } from 'zod';
import type { AppDeps } from '../../app';
import { branches, halls } from '../../db/schema';
import { conflict, isForeignKeyViolation, notFound } from '../../lib/errors';
import { uuidParam, validate } from '../../lib/http';
import {
  changeSeatKinds,
  createHall,
  hallDetail,
  listHalls,
  regenerateHall,
} from '../../services/halls';
import {
  AdminHallBody,
  AdminHallListQuery,
  AdminHallPatch,
  AdminHallRegenerateBody,
  AdminSeatChangesBody,
} from '../../shared';

export function createAdminHallsRouter({ db, clock, seatHub }: AppDeps): Router {
  const r = Router();

  r.get('/halls', validate(AdminHallListQuery, 'query'), async (_req, res) => {
    const { branchId } = res.locals.query as z.infer<typeof AdminHallListQuery>;
    res.json(await listHalls(db, branchId));
  });

  r.get('/halls/:id', async (req, res) => {
    res.json(await hallDetail(db, uuidParam(req)));
  });

  r.post('/halls', validate(AdminHallBody), async (req, res) => {
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.id, req.body.branchId));
    if (!branch) throw notFound('branch_not_found');
    res.status(201).json(await hallDetail(db, await createHall(db, req.body)));
  });

  r.patch('/halls/:id', validate(AdminHallPatch), async (req, res) => {
    const id = uuidParam(req);
    const b = req.body as z.infer<typeof AdminHallPatch>;
    const patch = {
      ...(b.name !== undefined && { name: b.name }),
      ...(b.screen_width_m !== undefined && { screenWidthM: b.screen_width_m }),
      ...(b.screen_height_m !== undefined && { screenHeightM: b.screen_height_m }),
    };
    if (Object.keys(patch).length > 0) {
      const done = await db
        .update(halls)
        .set(patch)
        .where(eq(halls.id, id))
        .returning({ id: halls.id });
      if (done.length === 0) throw notFound();
    }
    res.json(await hallDetail(db, id));
  });

  r.delete('/halls/:id', async (req, res) => {
    try {
      const gone = await db
        .delete(halls)
        .where(eq(halls.id, uuidParam(req)))
        .returning({ id: halls.id });
      if (gone.length === 0) throw notFound();
    } catch (err) {
      if (isForeignKeyViolation(err)) throw conflict('in_use');
      throw err;
    }
    res.status(204).end();
  });

  r.put('/halls/:id/regenerate', validate(AdminHallRegenerateBody), async (req, res) => {
    const id = uuidParam(req);
    await regenerateHall(db, id, req.body.gen, clock());
    res.json(await hallDetail(db, id));
  });

  r.patch('/halls/:id/seats', validate(AdminSeatChangesBody), async (req, res) => {
    const id = uuidParam(req);
    await changeSeatKinds(db, seatHub, id, req.body.changes, clock());
    res.json(await hallDetail(db, id));
  });

  return r;
}
