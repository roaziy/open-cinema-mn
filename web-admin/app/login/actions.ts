'use server';

import { cookies } from 'next/headers';
import { RedirectType, redirect } from 'next/navigation';
import { readClaims } from '@/lib/auth/claims';
import { setAuthCookies } from '@/lib/auth/cookies';
import { safeNext } from '@/lib/auth/redirects';
import { postForTokens, postJson } from '@/lib/auth/server';
import { AdminLoginBody } from '@/lib/shared';

export type LoginState = { error?: string; email?: string };

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Имэйл эсвэл нууц үг буруу байна.',
  account_locked: 'Олон удаа буруу оруулсан тул хаагдлаа. 15 минутын дараа дахин оролдоно уу.',
  rate_limited: 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.',
  unreachable: 'Серверт холбогдож чадсангүй. Дахин оролдоно уу.',
};

export async function adminLogin(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim();
  const parsed = AdminLoginBody.safeParse({ email, password: String(form.get('password') ?? '') });
  if (!parsed.success) return { email, error: 'Имэйл болон нууц үгээ оруулна уу.' };

  const out = await postForTokens('/auth/admin/login', parsed.data);
  if (!out.ok)
    return { email, error: MESSAGES[out.code] ?? 'Нэвтэрч чадсангүй. Дахин оролдоно уу.' };

  const { accessToken, refreshToken, user } = out.data;
  if (user.role !== 'admin') {
    // Not an admin session: close it again rather than keep tokens this area cannot use.
    await postJson('/auth/logout', { refreshToken });
    return { email, error: MESSAGES.invalid_credentials };
  }
  setAuthCookies(await cookies(), { accessToken, refreshToken }, readClaims(accessToken)?.exp);
  redirect(safeNext(form.get('next'), '/admin'), RedirectType.replace);
}
