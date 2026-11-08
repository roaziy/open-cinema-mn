import { AuthTokensSchema, type PublicUser } from '@open-cinema/shared';
import { bffHeaders } from '../bff';
import { apiUrl } from '../env';
import type { Tokens } from './cookies';

export type RefreshResult =
  | { ok: true; tokens: Tokens; user: PublicUser }
  | {
      ok: false;
      /**
       * `invalid`: rejected (expired, or reused, which revokes every session): drop the session.
       * `superseded`: another request rotated this token a moment ago: keep the cookies, a newer
       * one is on its way to the browser.
       * `unavailable`: could not ask, or the API failed.
       */
      reason: 'invalid' | 'superseded' | 'unavailable';
    };

const INVALID_KEEP_MS = 5_000;
const inflight = new Map<string, Promise<RefreshResult>>();

async function callRefresh(refreshToken: string, ip: string | null): Promise<RefreshResult> {
  try {
    const res = await fetch(`${apiUrl()}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bffHeaders(ip) },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, reason: body.error === 'refresh_superseded' ? 'superseded' : 'invalid' };
    }
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const parsed = AuthTokensSchema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, reason: 'unavailable' };
    const { accessToken, refreshToken: next, user } = parsed.data;
    return { ok: true, tokens: { accessToken, refreshToken: next }, user };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Rotates the refresh token. Requests that overlap in time share one call, so a page and its
 * prefetches never each spend the same token (a replay revokes every session). Nothing is kept
 * once the call settles: a later request with the same token goes to the API, which decides.
 * Only a bare `invalid` (no credentials in it) is remembered for a few seconds, to avoid
 * hammering the API with a token it already refused.
 */
export function refreshSession(refreshToken: string, ip: string | null): Promise<RefreshResult> {
  const shared = inflight.get(refreshToken);
  if (shared) return shared;
  const call = callRefresh(refreshToken, ip).then((result) => {
    if (!result.ok && result.reason === 'invalid') {
      setTimeout(() => inflight.delete(refreshToken), INVALID_KEEP_MS).unref?.();
    } else {
      inflight.delete(refreshToken);
    }
    return result;
  });
  inflight.set(refreshToken, call);
  return call;
}

/** Best-effort `POST /auth/logout`: closes the session on the API. Never throws. */
export async function revokeSession(refreshToken: string, ip: string | null): Promise<void> {
  try {
    await fetch(`${apiUrl()}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bffHeaders(ip) },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // The cookies are dropped either way.
  }
}
