import { randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, like, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { otpCodes } from '../db/schema';
import { env } from '../env';
import { AppError } from './errors';
import { sha256 } from './tokens';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MS = 60 * 1000;
export const OTP_PER_HOUR = 5;

/** Which stored targets a rule applies to: one exact target, or every target with a prefix. */
export type Scope = { exact: string } | { prefix: string };

const scopeWhere = (s: Scope) =>
  'exact' in s ? eq(otpCodes.target, s.exact) : like(otpCodes.target, `${s.prefix}%`);

const hashCode = (target: string, code: string) => sha256(`${env.JWT_SECRET}:${target}:${code}`);

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Enforces 60 s resend and 5 per hour, then stores a fresh code and returns it for sending. */
export async function issueOtp(db: Db, now: Date, target: string, scope: Scope): Promise<string> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const recent = await db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(and(scopeWhere(scope), gt(otpCodes.createdAt, hourAgo)))
    .orderBy(desc(otpCodes.createdAt));
  if (recent.length >= OTP_PER_HOUR) throw new AppError(429, 'too_many_requests');
  const last = recent[0]?.createdAt;
  if (last && now.getTime() - last.getTime() < OTP_RESEND_MS) {
    throw new AppError(429, 'resend_too_soon');
  }
  const code = newCode();
  await db.insert(otpCodes).values({
    target,
    codeHash: hashCode(target, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    createdAt: now,
  });
  return code;
}

/**
 * Checks `code` against the newest code in `scope`. Counts the attempt, rejects after 5, and
 * deletes the target's codes on success so a code works once. Returns the matched target.
 */
export async function consumeOtp(db: Db, now: Date, scope: Scope, code: string): Promise<string> {
  const [row] = await db
    .select()
    .from(otpCodes)
    .where(scopeWhere(scope))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (!row || row.expiresAt <= now) throw new AppError(400, 'invalid_code');
  // Atomic increment so concurrent guesses cannot exceed the limit.
  const [counted] = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(and(eq(otpCodes.id, row.id), sql`${otpCodes.attempts} < ${OTP_MAX_ATTEMPTS}`))
    .returning({ id: otpCodes.id });
  if (!counted) throw new AppError(429, 'too_many_attempts');

  const a = Buffer.from(hashCode(row.target, code));
  const b = Buffer.from(row.codeHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError(400, 'invalid_code');

  const [used] = await db.delete(otpCodes).where(eq(otpCodes.id, row.id)).returning();
  if (!used) throw new AppError(400, 'invalid_code'); // lost a race with a parallel verify
  await db.delete(otpCodes).where(eq(otpCodes.target, row.target));
  return row.target;
}
