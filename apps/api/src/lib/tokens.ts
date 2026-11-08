import { createHash, randomBytes } from 'node:crypto';
import type { AuthTokens, PublicUser, Role } from '@open-cinema/shared';
import { eq } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import type { Db } from '../db/client';
import { sessions, type users } from '../db/schema';
import { env } from '../env';

export const ACCESS_TTL_S = 15 * 60;
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

/** Returns the user id when the token is valid, else null. Expiry is checked against `now`. */
export async function verifyAccessToken(token: string, now: Date): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ['HS256'],
      currentDate: now,
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

type UserRow = typeof users.$inferSelect;

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    role: u.role,
    phone: u.phone,
    email: u.email,
    emailVerified: u.emailVerifiedAt !== null,
    name: u.name,
    branchId: u.branchId,
  };
}

/** Creates a session and returns the token pair. The refresh token is stored only as a hash. */
export async function issueTokens(db: Db, user: UserRow, now: Date): Promise<AuthTokens> {
  const refreshToken = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    userId: user.id,
    refreshTokenHash: sha256(refreshToken),
    expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    createdAt: now,
  });
  return { accessToken: await signAccessToken(user, now), refreshToken, user: toPublicUser(user) };
}

export async function revokeAllSessions(db: Db, userId: string, now: Date): Promise<void> {
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.userId, userId));
}
