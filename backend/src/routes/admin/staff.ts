import { and, asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import type { AppDeps } from '../../app';
import type { Db } from '../../db/client';
import { branches, users } from '../../db/schema';
import { badRequest, conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { uuidParam, validate } from '../../lib/http';
import { type AdminStaff, AdminStaffBody, normalizePhone } from '../../shared';

async function staffView(db: Db, id: string): Promise<AdminStaff> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      branchId: users.branchId,
      branchName: branches.name,
    })
    .from(users)
    .leftJoin(branches, eq(branches.id, users.branchId))
    .where(eq(users.id, id));
  if (!row) throw notFound();
  return row;
}

export function createAdminStaffRouter({ db }: AppDeps): Router {
  const r = Router();

  r.get('/staff', async (_req, res) => {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        branchId: users.branchId,
        branchName: branches.name,
      })
      .from(users)
      .leftJoin(branches, eq(branches.id, users.branchId))
      .where(eq(users.role, 'staff'))
      .orderBy(asc(users.name), asc(users.createdAt));
    res.json(rows);
  });

  r.post('/staff', validate(AdminStaffBody), async (req, res) => {
    const body = req.body as AdminStaffBody;
    const phone = normalizePhone(body.phone);
    if (!phone) throw badRequest('invalid_phone');
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.id, body.branchId));
    if (!branch) throw notFound('branch_not_found');

    try {
      const id = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(eq(users.phone, phone))
          .for('update');
        if (!existing) {
          const [created] = await tx
            .insert(users)
            .values({ role: 'staff', phone, name: body.name, branchId: body.branchId })
            .returning({ id: users.id });
          return (created as { id: string }).id;
        }
        // Only a plain customer can be promoted, and only when the admin says so.
        if (existing.role !== 'customer' || !body.convert) throw conflict('phone_in_use');
        await tx
          .update(users)
          .set({ role: 'staff', branchId: body.branchId, name: body.name })
          .where(eq(users.id, existing.id));
        return existing.id;
      });
      res.status(201).json(await staffView(db, id));
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('phone_in_use');
      throw err;
    }
  });

  // The account stays (scans reference it); it just stops being staff.
  r.delete('/staff/:id', async (req, res) => {
    const demoted = await db
      .update(users)
      .set({ role: 'customer', branchId: null })
      .where(and(eq(users.id, uuidParam(req)), eq(users.role, 'staff')))
      .returning({ id: users.id });
    if (demoted.length === 0) throw notFound();
    res.status(204).end();
  });

  return r;
}
