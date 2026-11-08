import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ZodType } from 'zod';
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESHED_COOKIE } from './auth/cookies';
import { loginPathFor } from './auth/redirects';
import { API_URL } from './env';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API ${status} ${code}`);
  }
}

async function currentPath(): Promise<string> {
  return (await headers()).get('x-pathname') ?? '/admin';
}

/**
 * Server-side call to the API with the session's bearer.
 *
 * Server components cannot write cookies, so a 401 here sends the browser through
 * `/auth/refresh`, which rotates the tokens and comes back. If that already happened a moment ago
 * and the API still says 401, the session is dead and we sign out instead of looping.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const jar = await cookies();
  const access = jar.get(ACCESS_COOKIE)?.value;
  const next = encodeURIComponent(await currentPath());

  if (!access) {
    if (jar.has(REFRESH_COOKIE) && !jar.has(REFRESHED_COOKIE)) {
      redirect(`/auth/refresh?next=${next}`);
    }
    redirect(loginPathFor(await currentPath()));
  }

  const res = await fetch(`${API_URL}/v1${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...init.headers, authorization: `Bearer ${access}` },
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });

  if (res.status === 401) {
    const dead = jar.has(REFRESHED_COOKIE) || !jar.has(REFRESH_COOKIE);
    redirect(`/auth/refresh?next=${next}${dead ? '&signout=1' : ''}`);
  }
  return res;
}

/** GET + parse. Throws `ApiError` on any non-2xx so callers decide how to degrade. */
export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? 'unknown');
  }
  return schema.parse(await res.json());
}
