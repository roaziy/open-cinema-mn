'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { clearAuthCookies, REFRESH_COOKIE } from '@/lib/auth/cookies';
import { postJson } from '@/lib/auth/server';

const TARGETS = ['/login', '/staff/login'] as const;

/** Ends the session on the API (best effort) and drops the cookies. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) await postJson('/auth/logout', { refreshToken });
  clearAuthCookies(jar);
}

/**
 * Sign out and return to a login page. The target comes from the browser, so it is checked
 * against the two real login paths.
 */
export async function signOut(to: string) {
  await endSession();
  redirect(TARGETS.find((t) => t === to) ?? '/login');
}
