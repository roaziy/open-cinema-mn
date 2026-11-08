import { AdminBranchBody, AdminBranchPatch } from '@open-cinema/shared';
import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import type { AppDeps } from '../../app';
import { branches } from '../../db/schema';
import { conflict, isForeignKeyViolation, notFound } from '../../lib/errors';
import { uuidParam, validate } from '../../lib/http';
import { toBranch } from '../../services/catalog-views';

export function createAdminBranchesRouter({ db }: AppDeps): Router {
  const r = Router();

  r.get('/branches', async (_req, res) => {
    res.json((await db.select().from(branches).orderBy(asc(branches.name))).map(toBranch));
  });

  r.post('/branches', validate(AdminBranchBody), async (req, res) => {
    const [row] = await db.insert(branches).values(req.body).returning();
    res.status(201).json(toBranch(row as typeof branches.$inferSelect));
  });

  r.patch('/branches/:id', validate(AdminBranchPatch), async (req, res) => {
    const id = uuidParam(req);
    const patch = req.body as Record<string, unknown>;
    const [row] =
      Object.keys(patch).length > 0
        ? await db.update(branches).set(patch).where(eq(branches.id, id)).returning()
        : await db.select().from(branches).where(eq(branches.id, id));
    if (!row) throw notFound();
    res.json(toBranch(row));
  });

  r.delete('/branches/:id', async (req, res) => {
    try {
      const gone = await db
        .delete(branches)
        .where(eq(branches.id, uuidParam(req)))
        .returning({ id: branches.id });
      if (gone.length === 0) throw notFound();
    } catch (err) {
      if (isForeignKeyViolation(err)) throw conflict('in_use');
      throw err;
    }
    res.status(204).end();
  });

  return r;
}
