import { and, eq, sql } from 'drizzle-orm';
import { type Request, Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { sessions, users } from '../db/schema';
import { AppError, badRequest, forbidden, isUniqueViolation, unauthorized } from '../lib/errors';
import { validate } from '../lib/http';
import { consumeOtp, issueOtp, type Scope } from '../lib/otp';
import { hashPassword, verifyDummy, verifyPassword } from '../lib/password';
import { clientIp, type Limiters } from '../lib/rate-limit';
import {
  issueTokens,
  REFRESH_GRACE_MS,
  revokeAllSessions,
  sha256,
  toPublicUser,
} from '../lib/tokens';
import { otpEmail, otpSms } from '../messages/templates';
import { MessageSendError } from '../messages/wesend';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  AdminLoginBody,
  AdminPasswordBody,
  normalizeEmail,
  normalizePhone,
  type OtpChannel,
  OtpRequestBody,
  OtpVerifyBody,
  RefreshBody,
} from '../shared';

const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;

const NameBody = z.object({ name: z.string().trim().min(1).max(80) });
const EmailBody = z.object({ email: z.string().min(1).max(254) });
const CodeBody = z.object({ code: z.string().regex(/^\d{6}$/) });

const one = <T>(row: T | undefined): T => {
  if (row === undefined) throw new AppError(500, 'internal_error');
  return row;
};
const me = (req: Request) => one(req.user);

const normalizeTarget = (channel: OtpChannel, target: string) =>
  channel === 'sms' ? normalizePhone(target) : normalizeEmail(target);

export function createAuthRouter(deps: AppDeps, limiters: Limiters): Router {
  const { db, messages, clock } = deps;
  const r = Router();
  const auth = requireAuth(deps);

  /** Runs a send and turns any failure into `502 sms_failed` / `email_failed`. */
  async function send(kind: 'sms' | 'email', fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      // Never log the message itself: it contains the code.
      console.error(
        `[messages] ${kind} failed:`,
        err instanceof MessageSendError ? err.code : 'error',
      );
      throw new AppError(502, `${kind}_failed`);
    }
  }

  const sendCode = (channel: OtpChannel, target: string, code: string) =>
    channel === 'sms'
      ? send('sms', () => messages.sms(target, otpSms(code)))
      : send('email', () => messages.email({ to: target, ...otpEmail(code) }));

  async function findUser(column: 'phone' | 'email', value: string) {
    const [u] = await db.select().from(users).where(eq(users[column], value)).limit(1);
    return u;
  }

  r.post('/auth/otp/request', limiters.otp, validate(OtpRequestBody), async (req, res) => {
    const { channel, target: raw } = req.body as OtpRequestBody;
    const target = normalizeTarget(channel, raw);
    if (!target) throw badRequest('invalid_target');
    const code = await issueOtp(db, clock(), target, { exact: target });
    await sendCode(channel, target, code);
    res.status(204).end();
  });

  r.post('/auth/otp/verify', limiters.otp, validate(OtpVerifyBody), async (req, res) => {
    const { channel, target: raw, code } = req.body as OtpVerifyBody;
    const target = normalizeTarget(channel, raw);
    if (!target) throw badRequest('invalid_target');
    const now = clock();
    await consumeOtp(db, now, { exact: target }, code);

    const column = channel === 'sms' ? 'phone' : 'email';
    let user = await findUser(column, target);
    if (!user) {
      try {
        [user] = await db
          .insert(users)
          .values({
            role: 'customer',
            [column]: target,
            ...(channel === 'email' && { emailVerifiedAt: now }),
            createdAt: now,
          })
          .returning();
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        user = await findUser(column, target);
      }
    }
    if (!user) throw new AppError(500, 'internal_error');
    // Admins sign in with a password only, never by code.
    if (user.role === 'admin') throw forbidden();
    if (channel === 'email') {
      // Staff sign in by phone only.
      if (user.role === 'staff') throw forbidden();
      if (!user.emailVerifiedAt) {
        [user] = await db
          .update(users)
          .set({ emailVerifiedAt: now })
          .where(eq(users.id, user.id))
          .returning();
      }
    }
    res.json(await issueTokens(db, one(user), now));
  });

  r.post('/auth/guest', limiters.guest, async (_req, res) => {
    const now = clock();
    const [user] = await db.insert(users).values({ role: 'guest', createdAt: now }).returning();
    res.json(await issueTokens(db, one(user), now));
  });

  /**
   * A revoked refresh token came back. Within the grace after a rotation it is most likely a
   * response the client never received (same fingerprint): refuse it, keep the newer session. Anything else
   * (late, or revoked by logout) is treated as theft and ends every session of the user.
   */
  const fingerprint = (req: Request) =>
    sha256(`${clientIp(req)}\n${req.headers['user-agent'] ?? ''}`);

  async function rejectReplay(
    session: typeof sessions.$inferSelect,
    now: Date,
    fp: string,
  ): Promise<never> {
    const age = session.rotatedAt ? now.getTime() - session.rotatedAt.getTime() : null;
    // Only the client that rotated may replay: a thief who rotated first from elsewhere, or a
    // thief replaying a victim's token, presents a different fingerprint and ends everything.
    if (
      session.revokedReason === 'rotated' &&
      age !== null &&
      age <= REFRESH_GRACE_MS &&
      session.rotatedByFp === fp
    ) {
      throw unauthorized('refresh_superseded');
    }
    await revokeAllSessions(db, session.userId, now);
    throw unauthorized('invalid_refresh');
  }

  r.post('/auth/refresh', limiters.refresh, validate(RefreshBody), async (req, res) => {
    const { refreshToken } = req.body as RefreshBody;
    const now = clock();
    const fp = fingerprint(req);
    const hash = sha256(refreshToken);
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, hash))
      .limit(1);
    if (!session) throw unauthorized('invalid_refresh');
    // A revoked token coming back is reuse, expired or not: assume it leaked and end every
    // session of the user.
    if (session.revokedAt) await rejectReplay(session, now, fp);
    // An expired token that was never used is refused without touching other sessions.
    if (session.expiresAt <= now) throw unauthorized('refresh_expired');
    // Rotate atomically: only one caller can flip an active session to revoked.
    const [rotated] = await db
      .update(sessions)
      .set({ revokedAt: now, revokedReason: 'rotated', rotatedAt: now, rotatedByFp: fp })
      .where(and(eq(sessions.id, session.id), sql`${sessions.revokedAt} is null`))
      .returning({ id: sessions.id });
    if (!rotated) {
      // Lost a race with a concurrent refresh of the same token: same handling as a replay.
      const [fresh] = await db.select().from(sessions).where(eq(sessions.id, session.id));
      await rejectReplay(fresh ?? session, now, fp);
    }
    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user) throw unauthorized('invalid_refresh');
    res.json(await issueTokens(db, user, now));
  });

  r.post('/auth/logout', limiters.refresh, validate(RefreshBody), async (req, res) => {
    const { refreshToken } = req.body as RefreshBody;
    await db
      .update(sessions)
      .set({ revokedAt: clock(), revokedReason: 'logout' })
      .where(
        and(
          eq(sessions.refreshTokenHash, sha256(refreshToken)),
          sql`${sessions.revokedAt} is null`,
        ),
      );
    res.status(204).end();
  });

  /**
   * The row lock serializes attempts per account, so parallel guesses cannot skip the counter
   * or reset it while another attempt is locking the account. Used by login and password change.
   */
  async function checkAdminPassword(adminId: string, password: string, now: Date) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(users).where(eq(users.id, adminId)).for('update');
      if (!row?.passwordHash) return { kind: 'invalid' as const };
      if (row.lockedUntil && row.lockedUntil > now) return { kind: 'locked' as const };
      if (await verifyPassword(row.passwordHash, password)) {
        const [fresh] = await tx
          .update(users)
          .set({ failedLogins: 0, lockedUntil: null })
          .where(eq(users.id, adminId))
          .returning();
        return { kind: 'ok' as const, user: one(fresh) };
      }
      const failed = row.failedLogins + 1;
      await tx
        .update(users)
        .set(
          failed >= MAX_FAILED_LOGINS
            ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) }
            : { failedLogins: failed },
        )
        .where(eq(users.id, adminId));
      return { kind: 'invalid' as const };
    });
  }

  r.post('/auth/admin/login', limiters.login, validate(AdminLoginBody), async (req, res) => {
    const body = req.body as AdminLoginBody;
    const now = clock();
    const email = normalizeEmail(body.email);
    const [user] = email
      ? await db.select().from(users).where(eq(users.email, email)).limit(1)
      : [];
    if (user?.role !== 'admin' || !user.passwordHash) {
      await verifyDummy(body.password);
      throw unauthorized('invalid_credentials');
    }
    const outcome = await checkAdminPassword(user.id, body.password, now);
    if (outcome.kind === 'locked') throw new AppError(429, 'account_locked');
    if (outcome.kind === 'invalid') throw unauthorized('invalid_credentials');
    res.json(await issueTokens(db, outcome.user, now));
  });

  /**
   * Changes the signed-in admin's password. Every session of the account ends (a stolen session
   * must not outlive the change) and a fresh pair for this device comes back.
   */
  r.post(
    '/auth/admin/password',
    limiters.login,
    auth,
    requireRole('admin'),
    validate(AdminPasswordBody),
    async (req, res) => {
      const { current, next } = req.body as AdminPasswordBody;
      const now = clock();
      const outcome = await checkAdminPassword(me(req).id, current, now);
      if (outcome.kind === 'locked') throw new AppError(429, 'account_locked');
      // Not 401: the BFF would read that as an expired session and sign the admin out.
      if (outcome.kind === 'invalid') throw badRequest('wrong_password');
      const passwordHash = await hashPassword(next);
      const [user] = await db
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, outcome.user.id))
        .returning();
      await revokeAllSessions(db, outcome.user.id, now);
      res.json(await issueTokens(db, one(user), now));
    },
  );

  r.get('/me', auth, async (req, res) => {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, me(req).id))
      .limit(1);
    res.json(toPublicUser(one(user)));
  });

  r.patch('/me', auth, validate(NameBody), async (req, res) => {
    const { name } = req.body as z.infer<typeof NameBody>;
    const [user] = await db
      .update(users)
      .set({ name })
      .where(eq(users.id, me(req).id))
      .returning();
    res.json(toPublicUser(one(user)));
  });

  // Adding an email: the pending address lives in the OTP target, so no extra column is needed.
  const linkPrefix = (userId: string) => `link:${userId}:`;

  r.post('/me/email', auth, limiters.otp, validate(EmailBody), async (req, res) => {
    if (me(req).role === 'guest') throw forbidden();
    const email = normalizeEmail((req.body as z.infer<typeof EmailBody>).email);
    if (!email) throw badRequest('invalid_target');
    const taken = await findUser('email', email);
    if (taken && taken.id !== me(req).id) throw new AppError(409, 'email_taken');
    const prefix = linkPrefix(me(req).id);
    const scope: Scope = { prefix };
    const code = await issueOtp(db, clock(), `${prefix}${email}`, scope);
    await sendCode('email', email, code);
    res.status(204).end();
  });

  r.post('/me/email/verify', auth, limiters.otp, validate(CodeBody), async (req, res) => {
    const { code } = req.body as z.infer<typeof CodeBody>;
    const prefix = linkPrefix(me(req).id);
    const now = clock();
    const target = await consumeOtp(db, now, { prefix }, code);
    const email = target.slice(prefix.length);
    try {
      const [user] = await db
        .update(users)
        .set({ email, emailVerifiedAt: now })
        .where(eq(users.id, me(req).id))
        .returning();
      res.json(toPublicUser(one(user)));
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, 'email_taken');
      throw err;
    }
  });

  return r;
}
