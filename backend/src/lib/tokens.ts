import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import type { Db } from '../db/client';
import { sessions, type staffAccounts, type users } from '../db/schema';
import { env } from '../env';
import { type AuthTokens, type PublicUser, type Role, RoleSchema } from '../shared';

export const ACCESS_TTL_S = 15 * 60;
/** A just-rotated refresh token replayed within this window is a lost response, not theft. */
export const REFRESH_GRACE_MS = 30_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const key = () => new TextEncoder().encode(env.JWT_SECRET);

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export async function signAccessToken(
  user: { id: string; role: Role },
  now: Date,
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TTL_S)
    .sign(key());
}

/** Returns the account id and role when the token is valid, else null. Expiry is checked against `now`. */
export async function verifyAccessToken(
  token: string,
  now: Date,
): Promise<{ id: string; role: Role } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ['HS256'],
      currentDate: now,
    });
    const role = RoleSchema.safeParse(payload.role);
    if (typeof payload.sub !== 'string' || !role.success) return null;
    return { id: payload.sub, role: role.data };
  } catch {
    return null;
  }
}

type UserRow = typeof users.$inferSelect;
type StaffRow = typeof staffAccounts.$inferSelect;
/** Either kind of account; `role` says which table it came from. */
export type AccountRow = UserRow | StaffRow;

/** Staff and admins live in `staff_accounts`, guests and customers in `users`. */
export const isStaffRole = (role: Role): role is 'staff' | 'admin' =>
  role === 'staff' || role === 'admin';
const isStaffRow = (a: AccountRow): a is StaffRow => isStaffRole(a.role);

export function toPublicUser(a: AccountRow): PublicUser {
  return {
    id: a.id,
    role: a.role,
    phone: a.phone,
    email: a.email,
    // Back-office emails are set by an operator, never by a code the person had to receive.
    emailVerified: isStaffRow(a) ? a.email !== null : a.emailVerifiedAt !== null,
    name: a.name,
    branchId: isStaffRow(a) ? a.branchId : null,
  };
}

/** The column of `sessions` that owns a session. */
export type SessionOwner = { userId: string } | { staffAccountId: string };

export const ownerOf = (a: { id: string; role: Role }): SessionOwner =>
  isStaffRole(a.role) ? { staffAccountId: a.id } : { userId: a.id };

export const ownerOfSession = (s: typeof sessions.$inferSelect): SessionOwner | null =>
  s.staffAccountId ? { staffAccountId: s.staffAccountId } : s.userId ? { userId: s.userId } : null;

/** Creates a session and returns the token pair. The refresh token is stored only as a hash. */
export async function issueTokens(db: Db, account: AccountRow, now: Date): Promise<AuthTokens> {
  const refreshToken = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    ...ownerOf(account),
    refreshTokenHash: sha256(refreshToken),
    expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    createdAt: now,
  });
  return {
    accessToken: await signAccessToken(account, now),
    refreshToken,
    user: toPublicUser(account),
  };
}

export async function revokeAllSessions(db: Db, owner: SessionOwner, now: Date): Promise<void> {
  const column = 'userId' in owner ? sessions.userId : sessions.staffAccountId;
  const id = 'userId' in owner ? owner.userId : owner.staffAccountId;
  await db
    .update(sessions)
    .set({ revokedAt: now, revokedReason: 'revoked_all' })
    .where(eq(column, id));
}
