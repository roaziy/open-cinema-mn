import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import { sessions, users } from '../src/db/schema';
import { verifyPassword } from '../src/lib/password';
import { issueTokens } from '../src/lib/tokens';
import { AdminAccountError, createAdmin } from '../src/services/admin-account';
import { resetDb } from './helpers';

const now = new Date('2026-11-08T03:00:00Z');
const find = async (email: string) =>
  (await db.select().from(users).where(eq(users.email, email)))[0];

describe('createAdmin', () => {
  beforeEach(resetDb);

  it('creates an admin with an argon2 hash and a normalized email', async () => {
    expect(
      await createAdmin(db, { email: ' Boss@Example.com ', password: 'long-enough-1', now }),
    ).toBe('created');
    const row = await find('boss@example.com');
    expect(row).toMatchObject({ role: 'admin' });
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(row?.passwordHash ?? '', 'long-enough-1')).toBe(true);
  });

  it('does not touch other data', async () => {
    await db.insert(users).values({ role: 'customer', phone: '+97699112045' });
    await createAdmin(db, { email: 'boss@example.com', password: 'long-enough-1', now });
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it('refuses to overwrite an existing admin without reset', async () => {
    await createAdmin(db, { email: 'boss@example.com', password: 'long-enough-1', now });
    await expect(
      createAdmin(db, { email: 'boss@example.com', password: 'another-one-22', now }),
    ).rejects.toMatchObject({ code: 'exists' });
    const row = await find('boss@example.com');
    expect(await verifyPassword(row?.passwordHash ?? '', 'long-enough-1')).toBe(true);
  });

  it('resets the password and clears a lockout with reset', async () => {
    await createAdmin(db, { email: 'boss@example.com', password: 'long-enough-1', now });
    await db.update(users).set({ failedLogins: 3, lockedUntil: new Date(now.getTime() + 1000) });
    expect(
      await createAdmin(db, {
        email: 'boss@example.com',
        password: 'another-one-22',
        resetPassword: true,
        now,
      }),
    ).toBe('password_reset');
    const row = await find('boss@example.com');
    expect(row).toMatchObject({ failedLogins: 0, lockedUntil: null });
    expect(await verifyPassword(row?.passwordHash ?? '', 'another-one-22')).toBe(true);
  });

  it('reset revokes every existing session of that admin only', async () => {
    await createAdmin(db, { email: 'boss@example.com', password: 'long-enough-1', now });
    await createAdmin(db, { email: 'other@example.com', password: 'long-enough-1', now });
    const boss = await find('boss@example.com');
    const other = await find('other@example.com');
    if (!boss || !other) throw new Error('setup');
    await issueTokens(db, boss, now);
    await issueTokens(db, boss, now);
    await issueTokens(db, other, now);
    await createAdmin(db, {
      email: 'boss@example.com',
      password: 'another-one-22',
      resetPassword: true,
      now,
    });
    const rows = await db.select().from(sessions);
    const of = (id: string) => rows.filter((r) => r.userId === id);
    expect(of(boss.id)).toHaveLength(2);
    expect(of(boss.id).every((r) => r.revokedAt !== null)).toBe(true);
    expect(of(other.id).every((r) => r.revokedAt === null)).toBe(true);
  });

  it('rejects bad input and non-admin owners of the email', async () => {
    await expect(
      createAdmin(db, { email: 'nope', password: 'long-enough-1', now }),
    ).rejects.toBeInstanceOf(AdminAccountError);
    await expect(
      createAdmin(db, { email: 'a@b.mn', password: 'short', now }),
    ).rejects.toMatchObject({ code: 'weak_password' });
    await db.insert(users).values({ role: 'customer', email: 'c@b.mn' });
    await expect(
      createAdmin(db, { email: 'c@b.mn', password: 'long-enough-1', resetPassword: true, now }),
    ).rejects.toMatchObject({ code: 'not_admin' });
  });
});
