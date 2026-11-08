'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { clearAuthCookies, REFRESH_COOKIE } from '@/lib/auth/cookies';
import { postJson } from '@/lib/auth/server';

/** Ends the session on the API (best effort), drops the cookies and returns to a login page. */
export async function signOut(to: '/login' | '/staff/login') {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) await postJson('/auth/logout', { refreshToken });
  clearAuthCookies(jar);
  redirect(to);
}
