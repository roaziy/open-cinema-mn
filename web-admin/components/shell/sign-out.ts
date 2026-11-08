'use server';

import { cookies } from 'next/headers';
import { RedirectType, redirect } from 'next/navigation';
import { clearAuthCookies, REFRESH_COOKIE } from '@/lib/auth/cookies';
import type { Area } from '@/lib/auth/judge';
import { postJson } from '@/lib/auth/server';
import { verdictFor } from '@/lib/auth/verdict';

const TARGETS = ['/login', '/staff/login'] as const;

/** Revokes the session on the API (best effort) and drops the cookies. */
async function terminate(): Promise<void> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) await postJson('/auth/logout', { refreshToken });
  clearAuthCookies(jar);
}

/**
 * Called by a login page opened with `?error=`. It re-checks with the API first: only a session
 * that is dead or does not fit this area is ended; a healthy one goes home instead.
 */
export async function endDeadSession(area: Area): Promise<void> {
  if (area !== 'admin' && area !== 'staff') return;
  const verdict = await verdictFor(area);
  if (verdict === 'end') return terminate();
  if (verdict === 'home') {
    redirect(area === 'admin' ? '/admin' : '/staff', RedirectType.replace);
  }
}

/**
 * The user's own sign-out. The target comes from the browser, so it is checked against the two
 * real login paths.
 */
export async function signOut(to: string) {
  await terminate();
  redirect(TARGETS.find((t) => t === to) ?? '/login', RedirectType.replace);
}
