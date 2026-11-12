import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { hashPassword } from '../lib/password';
import { revokeAllSessions } from '../lib/tokens';
import { ADMIN_PASSWORD_MIN, normalizeEmail } from '../shared';

export type CreateAdminResult = 'created' | 'password_reset';

export class AdminAccountError extends Error {
  constructor(
    readonly code: 'invalid_email' | 'weak_password' | 'exists' | 'not_admin',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Creates the first (or another) admin without touching any other data. An existing admin is
 * left alone unless `resetPassword` is set, which also clears a lockout and revokes every session.
 */
export async function createAdmin(
  db: Db,
  opts: { email: string; name?: string; password: string; resetPassword?: boolean; now: Date },
): Promise<CreateAdminResult> {
  const email = normalizeEmail(opts.email);
  if (!email) throw new AdminAccountError('invalid_email', `not a valid email: ${opts.email}`);
  if (opts.password.length < ADMIN_PASSWORD_MIN) {
    throw new AdminAccountError(
      'weak_password',
      `the password must be at least ${ADMIN_PASSWORD_MIN} characters`,
    );
  }
  const passwordHash = await hashPassword(opts.password);
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!existing) {
    await db.insert(users).values({
      role: 'admin',
      email,
      emailVerifiedAt: opts.now,
      passwordHash,
      name: opts.name ?? null,
      createdAt: opts.now,
    });
    return 'created';
  }
  if (existing.role !== 'admin') {
    throw new AdminAccountError('not_admin', `${email} belongs to a ${existing.role} account`);
  }
  if (!opts.resetPassword) {
    throw new AdminAccountError('exists', `${email} is already an admin (use --reset-password)`);
  }
  await db
    .update(users)
    .set({
      passwordHash,
      failedLogins: 0,
      lockedUntil: null,
      ...(opts.name !== undefined && { name: opts.name }),
    })
    .where(eq(users.id, existing.id));
  await revokeAllSessions(db, existing.id, opts.now);
  return 'password_reset';
}
