import {
  AdminLoginBody,
  normalizeEmail,
  normalizePhone,
  type OtpChannel,
  OtpRequestBody,
  OtpVerifyBody,
  RefreshBody,
} from '@open-cinema/shared';
import { and, eq, sql } from 'drizzle-orm';
import { type Request, Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { sessions, users } from '../db/schema';
import { AppError, badRequest, forbidden, isUniqueViolation, unauthorized } from '../lib/errors';
import { validate } from '../lib/http';
import { consumeOtp, issueOtp, type Scope } from '../lib/otp';
import { verifyDummy, verifyPassword } from '../lib/password';
import type { Limiters } from '../lib/rate-limit';
import { issueTokens, revokeAllSessions, sha256, toPublicUser } from '../lib/tokens';
import { otpEmail, otpSms } from '../messages/templates';
import { MessageSendError } from '../messages/wesend';
import { requireAuth } from '../middleware/auth';

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
    if (channel === 'email') {
      // Staff and admins sign in by phone and password only.
      if (user.role === 'staff' || user.role === 'admin') throw forbidden();
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

  r.post('/auth/refresh', validate(RefreshBody), async (req, res) => {
    const { refreshToken } = req.body as RefreshBody;
    const now = clock();
    const hash = sha256(refreshToken);
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, hash))
      .limit(1);
    if (!session) throw unauthorized('invalid_refresh');
    // Rotate atomically: only one caller can flip an active session to revoked.
    const [rotated] = await db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.id, session.id), sql`${sessions.revokedAt} is null`))
      .returning({ id: sessions.id });
    if (!rotated) {
      // A used or revoked token came back: assume it leaked and end every session of the user.
      await revokeAllSessions(db, session.userId, now);
      throw unauthorized('invalid_refresh');
    }
    if (session.expiresAt <= now) throw unauthorized('invalid_refresh');
    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user) throw unauthorized('invalid_refresh');
    res.json(await issueTokens(db, user, now));
  });

  r.post('/auth/logout', validate(RefreshBody), async (req, res) => {
    const { refreshToken } = req.body as RefreshBody;
    await db
      .update(sessions)
      .set({ revokedAt: clock() })
      .where(
        and(
          eq(sessions.refreshTokenHash, sha256(refreshToken)),
          sql`${sessions.revokedAt} is null`,
        ),
      );
    res.status(204).end();
  });

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
    if (user.lockedUntil && user.lockedUntil > now) throw new AppError(429, 'account_locked');

    if (!(await verifyPassword(user.passwordHash, body.password))) {
      // One statement so parallel guesses cannot dodge the counter.
      await db
        .update(users)
        .set({
          failedLogins: sql`case when ${users.failedLogins} + 1 >= ${MAX_FAILED_LOGINS} then 0 else ${users.failedLogins} + 1 end`,
          lockedUntil: sql`case when ${users.failedLogins} + 1 >= ${MAX_FAILED_LOGINS} then ${new Date(now.getTime() + LOCK_MS)} else ${users.lockedUntil} end`,
        })
        .where(eq(users.id, user.id));
      throw unauthorized('invalid_credentials');
    }
    const [fresh] = await db
      .update(users)
      .set({ failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, user.id))
      .returning();
    res.json(await issueTokens(db, one(fresh), now));
  });

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
