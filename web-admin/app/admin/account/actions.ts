'use server';

import { AdminPasswordBody, AuthTokensSchema } from '@open-cinema/shared';
import { cookies } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { readClaims } from '@/lib/auth/claims';
import { setAuthCookies } from '@/lib/auth/cookies';

export type PasswordState = { error?: string; done?: boolean };

const MESSAGES: Record<string, string> = {
  wrong_password: 'Одоогийн нууц үг буруу байна.',
  account_locked: 'Олон удаа буруу оруулсан тул хаагдлаа. 15 минутын дараа дахин оролдоно уу.',
  rate_limited: 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.',
};

/** Changes the admin's password. The API ends every session and returns a fresh pair for this browser. */
export async function changePassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const next = String(form.get('next') ?? '');
  if (next !== String(form.get('repeat') ?? '')) return { error: 'Шинэ нууц үг таарахгүй байна.' };
  const parsed = AdminPasswordBody.safeParse({ current: String(form.get('current') ?? ''), next });
  if (!parsed.success) return { error: 'Шинэ нууц үг дор хаяж 8 тэмдэгттэй байх ёстой.' };

  let res: Response;
  try {
    res = await apiFetch('/auth/admin/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'Серверт холбогдож чадсангүй. Дахин оролдоно уу.' };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      error: MESSAGES[body.error ?? ''] ?? 'Нууц үг солиход алдаа гарлаа. Дахин оролдоно уу.',
    };
  }
  const tokens = AuthTokensSchema.safeParse(await res.json().catch(() => null));
  if (!tokens.success) return { error: 'Серверийн хариу буруу байна. Дахин нэвтэрнэ үү.' };
  const { accessToken, refreshToken } = tokens.data;
  setAuthCookies(await cookies(), { accessToken, refreshToken }, readClaims(accessToken)?.exp);
  return { done: true };
}
