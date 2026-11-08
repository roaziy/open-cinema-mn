import { AuthTokensSchema, type PublicUser } from '@open-cinema/shared';
import { API_URL } from '../env';
import type { Tokens } from './cookies';

export type RefreshResult =
  | { ok: true; tokens: Tokens; user: PublicUser }
  /** `invalid`: the API rejected the token (expired, or reused, which revokes every session). */
  | { ok: false; reason: 'invalid' | 'unavailable' };

const SHARE_MS = 20_000;
const inflight = new Map<string, Promise<RefreshResult>>();

async function callRefresh(refreshToken: string): Promise<RefreshResult> {
  try {
    const res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 401) return { ok: false, reason: 'invalid' };
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
 * Rotates the refresh token, once per token.
 *
 * Refresh tokens rotate and a replayed one revokes every session, so parallel requests (a page
 * plus its prefetches, several client fetches) must never each spend the same token. They all
 * share one call, and the outcome is kept for a few seconds for requests that still carry the old
 * cookie. A transient failure is not kept, so the token can be tried again.
 */
export function refreshSession(refreshToken: string): Promise<RefreshResult> {
  const shared = inflight.get(refreshToken);
  if (shared) return shared;
  const call = callRefresh(refreshToken).then((result) => {
    if (!result.ok && result.reason === 'unavailable') inflight.delete(refreshToken);
    return result;
  });
  inflight.set(refreshToken, call);
  setTimeout(() => inflight.delete(refreshToken), SHARE_MS).unref?.();
  return call;
}
