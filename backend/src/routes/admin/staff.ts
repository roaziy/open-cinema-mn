import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { Router } from 'express';
import type { AppDeps } from '../../app';
import type { Db } from '../../db/client';
import { branches, staffAccounts } from '../../db/schema';
import { badRequest, conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { uuidParam, validate } from '../../lib/http';
import { revokeAllSessions } from '../../lib/tokens';
import { type AdminStaff, AdminStaffBody, normalizePhone } from '../../shared';

const phoneIsSet = isNotNull(staffAccounts.phone);

async function staffView(db: Db, id: string): Promise<AdminStaff> {
  const [row] = await db
    .select({
      id: staffAccounts.id,
      name: staffAccounts.name,
      phone: staffAccounts.phone,
      branchId: staffAccounts.branchId,
      branchName: branches.name,
    })
    .from(staffAccounts)
    .leftJoin(branches, eq(branches.id, staffAccounts.branchId))
    .where(eq(staffAccounts.id, id));
  if (!row) throw notFound();
  return row;
}

export function createAdminStaffRouter({ db, clock }: AppDeps): Router {
  const r = Router();

  // A removed staff member keeps the account (scans reference it) but loses the phone, so it is
  // neither listed nor able to sign in.
  r.get('/staff', async (_req, res) => {
    const rows = await db
      .select({
        id: staffAccounts.id,
        name: staffAccounts.name,
        phone: staffAccounts.phone,
        branchId: staffAccounts.branchId,
        branchName: branches.name,
      })
      .from(staffAccounts)
      .leftJoin(branches, eq(branches.id, staffAccounts.branchId))
      .where(and(eq(staffAccounts.role, 'staff'), phoneIsSet))
      .orderBy(asc(staffAccounts.name), asc(staffAccounts.createdAt));
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
      // A customer with the same phone is a different account and does not block this.
      const [created] = await db
        .insert(staffAccounts)
        .values({ role: 'staff', phone, name: body.name, branchId: body.branchId })
        .returning({ id: staffAccounts.id });
      res.status(201).json(await staffView(db, (created as { id: string }).id));
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('phone_in_use');
      throw err;
    }
  });

  r.delete('/staff/:id', async (req, res) => {
    const [removed] = await db
      .update(staffAccounts)
      .set({ phone: null, branchId: null })
      .where(and(eq(staffAccounts.id, uuidParam(req)), eq(staffAccounts.role, 'staff'), phoneIsSet))
      .returning({ id: staffAccounts.id });
    if (!removed) throw notFound();
    await revokeAllSessions(db, { staffAccountId: removed.id }, clock());
    res.status(204).end();
  });

  return r;
}
