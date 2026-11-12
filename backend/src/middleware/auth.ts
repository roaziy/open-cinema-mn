import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import { verifyAccessToken } from '../lib/tokens';
import type { Role } from '../shared';

export type AuthUser = { id: string; role: Role; branchId: string | null };

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Requires a valid access token. The user is re-read from the database on every request so a
 * changed role, a moved branch or a deleted account takes effect immediately.
 */
export function requireAuth(deps: { db: Db; clock: () => Date }): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const userId = token ? await verifyAccessToken(token, deps.clock()) : null;
    if (!userId) throw unauthorized();
    const [user] = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw unauthorized();
    req.user = { id: user.id, role: user.role, branchId: user.branchId };
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
