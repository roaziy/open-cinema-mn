import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import type { Db } from '../db/client';
import { staffAccounts, users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import { isStaffRole, verifyAccessToken } from '../lib/tokens';
import type { Role } from '../shared';

export type AuthUser = { id: string; role: Role; branchId: string | null };

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Requires a valid access token. The account is re-read from the database on every request so a
 * moved branch or a deleted account takes effect immediately. The token's role says which table
 * it lives in (staff and admin in `staff_accounts`, the rest in `users`); the stored role is what
 * counts, so a token naming the wrong table finds nothing.
 */
export function requireAuth(deps: { db: Db; clock: () => Date }): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const claim = token ? await verifyAccessToken(token, deps.clock()) : null;
    if (!claim) throw unauthorized();
    if (isStaffRole(claim.role)) {
      const [acct] = await deps.db
        .select({
          id: staffAccounts.id,
          role: staffAccounts.role,
          branchId: staffAccounts.branchId,
        })
        .from(staffAccounts)
        .where(eq(staffAccounts.id, claim.id))
        .limit(1);
      if (!acct) throw unauthorized();
      req.user = { id: acct.id, role: acct.role, branchId: acct.branchId };
    } else {
      const [acct] = await deps.db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, claim.id))
        .limit(1);
      if (!acct) throw unauthorized();
      req.user = { id: acct.id, role: acct.role, branchId: null };
    }
    next();
  };
}

/** Use after `requireAuth`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };
}
