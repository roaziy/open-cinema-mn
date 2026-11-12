import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import { sessions, users } from '../src/db/schema';
import type { AppError } from '../src/lib/errors';
import { hashPassword } from '../src/lib/password';
import { issueTokens, sha256 } from '../src/lib/tokens';
import type { Messages } from '../src/messages';
import { requireAuth, requireRole } from '../src/middleware/auth';
import { fakeMessages, fixedClock, makeTestApp, resetDb } from './helpers';

const MIN = 60 * 1000;

function setup() {
  const messages = fakeMessages();
  const clock = fixedClock('2026-11-08T03:00:00Z');
  const app = makeTestApp({ messages, clock });
  const lastCode = () => {
    const last = messages.sent.at(-1);
    const m = last?.body.match(/\d{6}/);
    if (!m) throw new Error('no code sent');
    return m[0];
  };
  const otpLogin = async (channel: 'sms' | 'email', target: string) => {
    await request(app).post('/v1/auth/otp/request').send({ channel, target }).expect(204);
    return request(app).post('/v1/auth/otp/verify').send({ channel, target, code: lastCode() });
  };
  return { messages, clock, app, lastCode, otpLogin };
}

describe('otp login', () => {
  beforeEach(resetDb);

  it('sends a code by sms and returns tokens for a new customer', async () => {
    const { app, messages, otpLogin } = setup();
    const res = await otpLogin('sms', '99112045');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'customer', phone: '+97699112045' });
    expect(messages.sent[0]).toMatchObject({ channel: 'sms', to: '+97699112045' });
    const me = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.body.phone).toBe('+97699112045');
  });

  it('does not store the code in clear text', async () => {
    const { app, lastCode } = setup();
    await request(app).post('/v1/auth/otp/request').send({ channel: 'sms', target: '99112045' });
    const rows = await db.query.otpCodes.findMany();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(lastCode());
  });

  it('rejects a bad target and a wrong code', async () => {
    const { app } = setup();
    await request(app)
      .post('/v1/auth/otp/request')
      .send({ channel: 'sms', target: '123' })
      .expect(400, { error: 'invalid_target' });
    await request(app)
      .post('/v1/auth/otp/verify')
      .send({ channel: 'sms', target: '99112045', code: '000000' })
      .expect(400, { error: 'invalid_code' });
  });

  it('expires the code after 5 minutes', async () => {
    const { app, clock, lastCode } = setup();
    await request(app).post('/v1/auth/otp/request').send({ channel: 'sms', target: '99112045' });
    const code = lastCode();
    clock.advance(5 * MIN + 1000);
    const res = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ channel: 'sms', target: '99112045', code });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_code');
  });

  it('accepts the code only once', async () => {
    const { app, lastCode, otpLogin } = setup();
    await otpLogin('sms', '99112045');
    await request(app)
      .post('/v1/auth/otp/verify')
      .send({ channel: 'sms', target: '99112045', code: lastCode() })
      .expect(400);
  });

  it('locks a code after 5 attempts, even for the right code', async () => {
    const { app, lastCode } = setup();
    await request(app).post('/v1/auth/otp/request').send({ channel: 'sms', target: '99112045' });
    const right = lastCode();
    const wrong = right === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/v1/auth/otp/verify')
        .send({ channel: 'sms', target: '99112045', code: wrong })
        .expect(400);
    }
    const res = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ channel: 'sms', target: '99112045', code: right });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('too_many_attempts');
  });

  it('blocks a resend before 60 s and allows it after', async () => {
    const { app, clock } = setup();
    const body = { channel: 'sms', target: '99112045' };
    await request(app).post('/v1/auth/otp/request').send(body).expect(204);
    clock.advance(59_000);
    const res = await request(app).post('/v1/auth/otp/request').send(body);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('resend_too_soon');
    clock.advance(1000);
    await request(app).post('/v1/auth/otp/request').send(body).expect(204);
  });

  it('allows 5 codes per target per hour, then 429', async () => {
    const { app, clock } = setup();
    const body = { channel: 'sms', target: '99112045' };
    for (let i = 0; i < 5; i++) {
      await request(app).post('/v1/auth/otp/request').send(body).expect(204);
      clock.advance(61_000);
    }
    const res = await request(app).post('/v1/auth/otp/request').send(body);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('too_many_requests');
    clock.advance(60 * MIN);
    await request(app).post('/v1/auth/otp/request').send(body).expect(204);
  });

  it('applies the per-IP limit to otp requests', async () => {
    const { app } = setup();
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const res = await request(app)
        .post('/v1/auth/otp/request')
        .send({ channel: 'sms', target: `9911${String(1000 + i)}` });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it('maps three phone spellings to one user', async () => {
    const { clock, app, messages, lastCode } = setup();
    const ids = new Set<string>();
    for (const spelling of ['+976 9911 2045', '99112045', '97699112045']) {
      await request(app)
        .post('/v1/auth/otp/request')
        .send({ channel: 'sms', target: spelling })
        .expect(204);
      const res = await request(app)
        .post('/v1/auth/otp/verify')
        .send({ channel: 'sms', target: spelling, code: lastCode() })
        .expect(200);
      ids.add(res.body.user.id);
      clock.advance(61_000);
    }
    expect(ids.size).toBe(1);
    expect(messages.sent.every((m) => m.to === '+97699112045')).toBe(true);
    expect(await db.query.users.findMany()).toHaveLength(1);
  });

  it('logs in an existing staff phone without creating a customer', async () => {
    const { otpLogin } = setup();
    const [staff] = await db
      .insert(users)
      .values({ role: 'staff', phone: '+97688000001' })
      .returning();
    const res = await otpLogin('sms', '88000001');
    expect(res.body.user).toMatchObject({ id: staff?.id, role: 'staff' });
    expect(await db.query.users.findMany()).toHaveLength(1);
  });

  it('email login sets emailVerified and treats spellings as one email', async () => {
    const { otpLogin, clock } = setup();
    const first = await otpLogin('email', ' Bat@Mail.MN ');
    expect(first.body.user).toMatchObject({ email: 'bat@mail.mn', emailVerified: true });
    clock.advance(61_000);
    const second = await otpLogin('email', 'bat@mail.mn');
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('refuses email login for staff accounts', async () => {
    const { otpLogin } = setup();
    await db.insert(users).values({ role: 'staff', phone: '+97688000001', email: 's@mail.mn' });
    const res = await otpLogin('email', 's@mail.mn');
    expect(res.status).toBe(403);
  });

  it('returns 502 sms_failed but keeps the code so a resend works', async () => {
    const failing: Messages = {
      async sms() {
        throw new Error('boom');
      },
      async email() {},
    };
    const clock = fixedClock('2026-11-08T03:00:00Z');
    const app = makeTestApp({ messages: failing, clock });
    const res = await request(app)
      .post('/v1/auth/otp/request')
      .send({ channel: 'sms', target: '99112045' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('sms_failed');
    expect(await db.query.otpCodes.findMany()).toHaveLength(1);
  });

  it('returns 502 email_failed', async () => {
    const failing: Messages = {
      async sms() {},
      async email() {
        throw new Error('boom');
      },
    };
    const app = makeTestApp({ messages: failing });
    const res = await request(app)
      .post('/v1/auth/otp/request')
      .send({ channel: 'email', target: 'a@b.mn' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('email_failed');
  });
});

describe('otp hardening', () => {
  beforeEach(resetDb);

  it('parallel requests for one target produce one code and one 204', async () => {
    const { app, messages } = setup();
    const body = { channel: 'sms', target: '99112045' };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post('/v1/auth/otp/request').send(body)),
    );
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
    expect(results.filter((r) => r.status === 429)).toHaveLength(4);
    expect(await db.query.otpCodes.findMany()).toHaveLength(1);
    expect(messages.sent).toHaveLength(1);
  });

  it('refuses a login target shaped like a link scope and leaves a pending link code alone', async () => {
    const { app, otpLogin, lastCode } = setup();
    const t = (await otpLogin('sms', '99112045')).body;
    const auth = { Authorization: `Bearer ${t.accessToken}` };
    await request(app).post('/v1/me/email').set(auth).send({ email: 'bat@mail.mn' }).expect(204);
    const real = lastCode();
    const before = await db.query.otpCodes.findMany();
    const planted = `link:${t.user.id}:x@y.mn`;
    await request(app)
      .post('/v1/auth/otp/request')
      .send({ channel: 'email', target: planted })
      .expect(400, { error: 'invalid_target' });
    await request(app)
      .post('/v1/auth/otp/verify')
      .send({ channel: 'email', target: planted, code: '123456' })
      .expect(400, { error: 'invalid_target' });
    expect(await db.query.otpCodes.findMany()).toHaveLength(before.length);
    await request(app).post('/v1/me/email/verify').set(auth).send({ code: real }).expect(200);
  });

  it('phone login refuses an admin that has a phone', async () => {
    const { otpLogin } = setup();
    await db.insert(users).values({ role: 'admin', phone: '+97688000009', email: 'a@x.mn' });
    const res = await otpLogin('sms', '88000009');
    expect(res.status).toBe(403);
  });
});

describe('guest, refresh, logout', () => {
  beforeEach(resetDb);

  it('creates a guest with role guest', async () => {
    const { app } = setup();
    const res = await request(app).post('/v1/auth/guest').expect(200);
    expect(res.body.user).toMatchObject({ role: 'guest', phone: null, email: null });
    const me = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.body.role).toBe('guest');
  });

  it('limits guest creation per IP', async () => {
    const { app } = setup();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await request(app).post('/v1/auth/guest')).status;
    expect(last).toBe(429);
  });

  it('rejects missing, garbage and expired access tokens', async () => {
    const { app, clock } = setup();
    await request(app).get('/v1/me').expect(401);
    await request(app).get('/v1/me').set('Authorization', 'Bearer nope').expect(401);
    const g = await request(app).post('/v1/auth/guest');
    clock.advance(15 * MIN + 1000);
    await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${g.body.accessToken}`)
      .expect(401);
  });

  it('rotates the refresh token and revokes the family when an old one is reused', async () => {
    const { app, clock } = setup();
    const g = await request(app).post('/v1/auth/guest');
    const first = g.body.refreshToken as string;
    const r1 = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(200);
    expect(r1.body.refreshToken).not.toBe(first);
    expect(r1.body.user.id).toBe(g.body.user.id);
    // reuse of the rotated token, after the grace
    clock.advance(31_000);
    const reuse = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(401);
    expect(reuse.body.error).toBe('invalid_refresh');
    // the newest token was revoked with the family
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
  });

  it('replay within 30 s is refresh_superseded and keeps the newer session', async () => {
    const { app, clock } = setup();
    const g = await request(app).post('/v1/auth/guest');
    const first = g.body.refreshToken as string;
    const r1 = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(200);
    clock.advance(29_000);
    const replay = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(401);
    expect(replay.body.error).toBe('refresh_superseded');
    // the newer session still works, and replaying again changes nothing
    await request(app).post('/v1/auth/refresh').send({ refreshToken: first }).expect(401);
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(200);
  });

  const refresh = (
    app: ReturnType<typeof setup>['app'],
    token: string,
    headers: Record<string, string> = {},
  ) => request(app).post('/v1/auth/refresh').set(headers).send({ refreshToken: token });
  const activeSessions = async () =>
    (await db.select().from(sessions)).filter((r) => r.revokedAt === null).length;

  it('replay at 29 s from a different user agent or address revokes every session', async () => {
    const BFF = { 'x-oc-bff-secret': 'test-bff-secret-0123456789abcdef' };
    const cases: Record<string, string>[] = [
      { 'user-agent': 'other-browser' },
      { ...BFF, 'x-oc-client-ip': '203.0.113.50' },
    ];
    for (const different of cases) {
      await resetDb();
      const { app, clock } = setup();
      const g = await request(app).post('/v1/auth/guest');
      const mine = { 'user-agent': 'my-browser', ...BFF, 'x-oc-client-ip': '203.0.113.7' };
      const r1 = await refresh(app, g.body.refreshToken, mine).expect(200);
      clock.advance(29_000);
      const replay = await refresh(app, g.body.refreshToken, { ...mine, ...different }).expect(401);
      expect(replay.body.error).toBe('invalid_refresh');
      await refresh(app, r1.body.refreshToken, mine).expect(401);
      expect(await activeSessions()).toBe(0);
    }
  });

  it('ends the attacker session when the attacker rotates a stolen token first', async () => {
    const { app, clock } = setup();
    const g = await request(app).post('/v1/auth/guest');
    const victim = { 'user-agent': 'victim-phone' };
    const attacker = { 'user-agent': 'attacker-box' };
    const stolen = await refresh(app, g.body.refreshToken, attacker).expect(200);
    clock.advance(5_000);
    // the real client now presents the token it still holds
    const res = await refresh(app, g.body.refreshToken, victim).expect(401);
    expect(res.body.error).toBe('invalid_refresh');
    await refresh(app, stolen.body.refreshToken, attacker).expect(401);
    expect(await activeSessions()).toBe(0);
  });

  it('replay at 31 s revokes every session', async () => {
    const { app, clock } = setup();
    const g = await request(app).post('/v1/auth/guest');
    const first = g.body.refreshToken as string;
    const r1 = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(200);
    clock.advance(31_000);
    const replay = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(401);
    expect(replay.body.error).toBe('invalid_refresh');
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
  });

  it('a logged-out token is never given the grace and a replay ends the other sessions', async () => {
    const { app, clock } = setup();
    const g = await request(app).post('/v1/auth/guest');
    const token = g.body.refreshToken as string;
    const [user] = await db.select().from(users).where(eq(users.id, g.body.user.id));
    const other = await issueTokens(db, user as typeof users.$inferSelect, clock());
    await request(app).post('/v1/auth/logout').send({ refreshToken: token }).expect(204);
    expect(await activeSessions()).toBe(1);
    const res = await refresh(app, token).expect(401);
    expect(res.body.error).toBe('invalid_refresh');
    expect(await activeSessions()).toBe(0);
    await refresh(app, other.refreshToken).expect(401);
  });

  it('two simultaneous refreshes of one token: one wins, the other is superseded', async () => {
    const { app } = setup();
    const g = await request(app).post('/v1/auth/guest');
    const send = () =>
      request(app).post('/v1/auth/refresh').send({ refreshToken: g.body.refreshToken });
    const [x, y] = await Promise.all([send(), send()]);
    expect([x.status, y.status].sort()).toEqual([200, 401]);
    const loser = x.status === 401 ? x : y;
    const winner = x.status === 200 ? x : y;
    expect(loser.body.error).toBe('refresh_superseded');
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: winner.body.refreshToken })
      .expect(200);
  });

  it('rejects an unknown or expired refresh token', async () => {
    const { app, clock } = setup();
    await request(app).post('/v1/auth/refresh').send({ refreshToken: 'unknown' }).expect(401);
    const g = await request(app).post('/v1/auth/guest');
    clock.advance(30 * 24 * 60 * MIN + 1000);
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: g.body.refreshToken })
      .expect(401);
  });

  it('answers a never-rotated expired refresh with refresh_expired and revokes nothing', async () => {
    const { app, clock } = setup();
    const g = await request(app).post('/v1/auth/guest');
    await db.insert(sessions).values({
      userId: g.body.user.id,
      refreshTokenHash: sha256('stale-token'),
      expiresAt: new Date(clock().getTime() - MIN),
    });
    for (let i = 0; i < 2; i++) {
      const res = await request(app).post('/v1/auth/refresh').send({ refreshToken: 'stale-token' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('refresh_expired');
    }
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: g.body.refreshToken })
      .expect(200);
  });

  it('treats a rotated token replayed after expiry as reuse and revokes all sessions', async () => {
    const { app, clock } = setup();
    const a = await request(app).post('/v1/auth/guest');
    clock.advance(29 * 24 * 60 * MIN);
    const b = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: a.body.refreshToken })
      .expect(200);
    clock.advance(2 * 24 * 60 * MIN); // a is now rotated and expired; b is still valid
    const replay = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: a.body.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('invalid_refresh');
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: b.body.refreshToken })
      .expect(401);
  });

  it('stores only a hash of the refresh token', async () => {
    const { app } = setup();
    const g = await request(app).post('/v1/auth/guest');
    const rows = await db.select().from(sessions);
    expect(JSON.stringify(rows)).not.toContain(g.body.refreshToken);
  });

  it('logout revokes the session', async () => {
    const { app } = setup();
    const g = await request(app).post('/v1/auth/guest');
    await request(app)
      .post('/v1/auth/logout')
      .send({ refreshToken: g.body.refreshToken })
      .expect(204);
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: g.body.refreshToken })
      .expect(401);
  });
});

describe('admin login', () => {
  beforeEach(resetDb);

  async function seedAdmin() {
    await db.insert(users).values({
      role: 'admin',
      email: 'admin@example.com',
      passwordHash: await hashPassword('correct-horse'),
    });
  }
  const login = (
    app: ReturnType<typeof makeTestApp>,
    password: string,
    email = 'Admin@Example.com',
  ) => request(app).post('/v1/auth/admin/login').send({ email, password });

  it('logs in with the right password', async () => {
    await seedAdmin();
    const res = await login(setup().app, 'correct-horse');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'admin', email: 'admin@example.com' });
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    await seedAdmin();
    const { app } = setup();
    const a = await login(app, 'nope');
    const b = await login(app, 'nope', 'who@example.com');
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body).toEqual(b.body);
  });

  it('refuses non-admin accounts', async () => {
    await db.insert(users).values({
      role: 'customer',
      email: 'c@example.com',
      passwordHash: await hashPassword('correct-horse'),
    });
    expect((await login(setup().app, 'correct-horse', 'c@example.com')).status).toBe(401);
  });

  it('locks for 15 minutes after 5 wrong passwords, then allows login', async () => {
    await seedAdmin();
    const { app, clock } = setup();
    for (let i = 0; i < 5; i++) await login(app, 'wrong').expect(401);
    const locked = await login(app, 'correct-horse');
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('account_locked');
    clock.advance(14 * MIN);
    expect((await login(app, 'correct-horse')).status).toBe(429);
    clock.advance(1 * MIN + 1000);
    expect((await login(app, 'correct-horse')).status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.email, 'admin@example.com'));
    expect(row).toMatchObject({ failedLogins: 0, lockedUntil: null });
  });

  it('10 concurrent wrong logins still lock the account', async () => {
    await seedAdmin();
    const { app } = setup();
    const results = await Promise.all(Array.from({ length: 10 }, () => login(app, 'wrong')));
    expect(
      results.filter((r) => r.status === 401 && r.body.error === 'invalid_credentials'),
    ).toHaveLength(5);
    expect(
      results.filter((r) => r.status === 429 && r.body.error === 'account_locked'),
    ).toHaveLength(5);
    const res = await login(app, 'correct-horse');
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('account_locked');
  });

  it('a success resets the failure counter', async () => {
    await seedAdmin();
    const { app } = setup();
    for (let i = 0; i < 4; i++) await login(app, 'wrong').expect(401);
    await login(app, 'correct-horse').expect(200);
    for (let i = 0; i < 4; i++) await login(app, 'wrong').expect(401);
    expect((await login(app, 'correct-horse')).status).toBe(200);
  });
});

describe('admin password change', () => {
  beforeEach(resetDb);

  async function adminSession() {
    const [row] = await db
      .insert(users)
      .values({
        role: 'admin',
        email: 'admin@example.com',
        passwordHash: await hashPassword('correct-horse'),
      })
      .returning();
    const ctx = setup();
    const login = await request(ctx.app)
      .post('/v1/auth/admin/login')
      .send({ email: 'admin@example.com', password: 'correct-horse' })
      .expect(200);
    return { ...ctx, id: (row as { id: string }).id, tokens: login.body };
  }
  const change = (
    app: ReturnType<typeof makeTestApp>,
    token: string,
    body: Record<string, unknown>,
  ) =>
    request(app).post('/v1/auth/admin/password').set('authorization', `Bearer ${token}`).send(body);

  it('verifies the current password, sets the new one and ends every other session', async () => {
    const { app, tokens } = await adminSession();
    const other = await request(app)
      .post('/v1/auth/admin/login')
      .send({ email: 'admin@example.com', password: 'correct-horse' })
      .expect(200);
    const res = await change(app, tokens.accessToken, {
      current: 'correct-horse',
      next: 'a-better-password',
    }).expect(200);
    expect(res.body.user).toMatchObject({ role: 'admin' });
    // The old password and the other device's refresh token are dead; the new pair works.
    await request(app)
      .post('/v1/auth/admin/login')
      .send({ email: 'admin@example.com', password: 'correct-horse' })
      .expect(401);
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: res.body.refreshToken })
      .expect(200);
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: other.body.refreshToken })
      .expect(401);
  });

  it('refuses a wrong current password with 400 (not 401) and counts it as a failed attempt', async () => {
    const { app, tokens } = await adminSession();
    const res = await change(app, tokens.accessToken, {
      current: 'nope',
      next: 'a-better-password',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('wrong_password');
    for (let i = 0; i < 4; i++) {
      await change(app, tokens.accessToken, { current: 'nope', next: 'a-better-password' });
    }
    const locked = await change(app, tokens.accessToken, {
      current: 'correct-horse',
      next: 'a-better-password',
    });
    expect(locked.status).toBe(429);
  });

  it('enforces the minimum length', async () => {
    const { app, tokens } = await adminSession();
    await change(app, tokens.accessToken, { current: 'correct-horse', next: 'short' }).expect(400);
  });

  it('is admin only', async () => {
    const { app } = await adminSession();
    const [cust] = await db
      .insert(users)
      .values({ role: 'customer', phone: '+97699112045' })
      .returning();
    const t = await issueTokens(db, cust as typeof users.$inferSelect, new Date());
    await change(app, t.accessToken, { current: 'x', next: 'a-better-password' }).expect(403);
    await request(app)
      .post('/v1/auth/admin/password')
      .send({ current: 'x', next: 'a-better-password' })
      .expect(401);
  });
});

describe('profile and roles', () => {
  beforeEach(resetDb);

  it('updates the name', async () => {
    const { app, otpLogin } = setup();
    const t = (await otpLogin('sms', '99112045')).body;
    const res = await request(app)
      .patch('/v1/me')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .send({ name: '  Bat  ' })
      .expect(200);
    expect(res.body.name).toBe('Bat');
    await request(app)
      .patch('/v1/me')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .send({ name: '' })
      .expect(400);
  });

  it('adds an email only after the code is verified', async () => {
    const { app, otpLogin, lastCode, messages } = setup();
    const t = (await otpLogin('sms', '99112045')).body;
    const auth = { Authorization: `Bearer ${t.accessToken}` };
    await request(app).post('/v1/me/email').set(auth).send({ email: ' Bat@Mail.MN' }).expect(204);
    expect(messages.sent.at(-1)).toMatchObject({ channel: 'email', to: 'bat@mail.mn' });
    expect((await request(app).get('/v1/me').set(auth)).body.email).toBeNull();
    await request(app).post('/v1/me/email/verify').set(auth).send({ code: '000000' }).expect(400);
    const res = await request(app)
      .post('/v1/me/email/verify')
      .set(auth)
      .send({ code: lastCode() })
      .expect(200);
    expect(res.body).toMatchObject({ email: 'bat@mail.mn', emailVerified: true });
  });

  it('refuses an email that belongs to another user and refuses guests', async () => {
    const { app, otpLogin } = setup();
    await db.insert(users).values({ role: 'customer', email: 'taken@mail.mn' });
    const t = (await otpLogin('sms', '99112045')).body;
    await request(app)
      .post('/v1/me/email')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .send({ email: 'taken@mail.mn' })
      .expect(409);
    const g = await request(app).post('/v1/auth/guest');
    await request(app)
      .post('/v1/me/email')
      .set('Authorization', `Bearer ${g.body.accessToken}`)
      .send({ email: 'x@mail.mn' })
      .expect(403);
  });

  it('requireRole lets staff through and rejects a customer with 403', async () => {
    const messages = fakeMessages();
    const clock = fixedClock('2026-11-08T03:00:00Z');
    const api = makeTestApp({ messages, clock });
    const probe = express();
    probe.get('/staff', requireAuth({ db, clock }), requireRole('staff', 'admin'), (req, res) => {
      res.json({ id: req.user?.id });
    });
    probe.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const e = err as AppError;
        res.status(e.status).json({ error: e.code });
      },
    );
    const login = async (phone: string) => {
      await request(api).post('/v1/auth/otp/request').send({ channel: 'sms', target: phone });
      const code = messages.sent.at(-1)?.body.match(/\d{6}/)?.[0];
      return (
        await request(api).post('/v1/auth/otp/verify').send({ channel: 'sms', target: phone, code })
      ).body;
    };
    await db.insert(users).values({ role: 'staff', phone: '+97688000001' });
    const customer = await login('99112045');
    const staff = await login('88000001');
    const denied = await request(probe)
      .get('/staff')
      .set('Authorization', `Bearer ${customer.accessToken}`);
    expect(denied.status).toBe(403);
    await request(probe).get('/staff').expect(401);
    const ok = await request(probe)
      .get('/staff')
      .set('Authorization', `Bearer ${staff.accessToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(staff.user.id);
  });
});

describe('refresh_reason constraint', () => {
  beforeEach(resetDb);
  it('refuses an unknown revoked_reason', async () => {
    const [u] = await db.insert(users).values({ role: 'guest' }).returning();
    await expect(
      db.insert(sessions).values({
        userId: (u as { id: string }).id,
        refreshTokenHash: 'h',
        expiresAt: new Date(),
        revokedReason: 'bogus',
      }),
    ).rejects.toThrow();
  });
});

describe('trusted BFF client ip', () => {
  const SECRET = 'test-bff-secret-0123456789abcdef';
  const guest = (app: ReturnType<typeof setup>['app'], headers: Record<string, string>) =>
    request(app).post('/v1/auth/guest').set(headers);

  it('gives each forwarded client its own bucket when the secret matches', async () => {
    const { app } = setup();
    const a = { 'x-oc-bff-secret': SECRET, 'x-oc-client-ip': '203.0.113.1' };
    const b = { 'x-oc-bff-secret': SECRET, 'x-oc-client-ip': '203.0.113.2' };
    for (let i = 0; i < 30; i++) await guest(app, a).expect(200);
    await guest(app, a).expect(429);
    await guest(app, b).expect(200);
  });

  it('buckets IPv6 clients by /56 and falls back to the socket for a garbage address', async () => {
    const { app } = setup();
    const h = (ip: string) => ({ 'x-oc-bff-secret': SECRET, 'x-oc-client-ip': ip });
    for (let i = 0; i < 30; i++) await guest(app, h('2001:db8:0:1::1')).expect(200);
    await guest(app, h('2001:db8:0:ff::2')).expect(429); // same /56
    await guest(app, h('2001:db8:0:100::1')).expect(200); // next /56
    for (let i = 0; i < 30; i++) await guest(app, h(`not-an-ip-${i}`)).expect(200);
    await guest(app, h('also garbage')).expect(429); // all of them were the socket's bucket
  });

  it('ignores the header with a wrong or missing secret', async () => {
    const { app } = setup();
    for (let i = 0; i < 30; i++) {
      await guest(app, { 'x-oc-bff-secret': 'wrong', 'x-oc-client-ip': `203.0.113.${i}` }).expect(
        200,
      );
    }
    // all of that shared one bucket (the socket address), whatever the header said
    await guest(app, { 'x-oc-client-ip': '198.51.100.9' }).expect(429);
    await guest(app, { 'x-oc-bff-secret': 'wrong', 'x-oc-client-ip': '198.51.100.10' }).expect(429);
  });
});

describe('staff sign-in by code', () => {
  beforeEach(resetDb);

  it('sends no code to a number that is not a staff account', async () => {
    const { app, messages } = setup();
    await db.insert(users).values({ role: 'customer', phone: '+97699112045' });
    for (const target of ['99112045', '95049990']) {
      const res = await request(app)
        .post('/v1/auth/otp/request')
        .send({ channel: 'sms', target, as: 'staff' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('not_staff');
    }
    expect(messages.sent).toHaveLength(0);
  });

  it('signs a staff member in', async () => {
    const { app, lastCode } = setup();
    await db.insert(users).values({ role: 'staff', phone: '+97688000001' });
    const body = { channel: 'sms', target: '88000001', as: 'staff' };
    await request(app).post('/v1/auth/otp/request').send(body).expect(204);
    const res = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ ...body, code: lastCode() });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'staff', phone: '+97688000001' });
  });

  it('never creates an account through the staff path', async () => {
    const { app, lastCode } = setup();
    await request(app)
      .post('/v1/auth/otp/request')
      .send({ channel: 'sms', target: '95049990' })
      .expect(204);
    const res = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ channel: 'sms', target: '95049990', code: lastCode(), as: 'staff' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_staff');
    const found = await db.select().from(users).where(eq(users.phone, '+97695049990'));
    expect(found).toHaveLength(0);
  });
});
