import { ensureGuest, getAccessToken, refreshSession } from './auth';
import { ApiError, type RequestOptions, rawRequest } from './http';

export { ApiError } from './http';

export type ApiInit = Omit<RequestOptions, 'bearer'> & {
  /** Set false for calls that must not create a guest session or send a token. */
  auth?: boolean;
};

/**
 * Typed call to `/v1<path>` with the bearer token attached (a guest session is created on
 * first use). On 401 the session is refreshed once (single-flight) and the call is replayed
 * once. Throws `ApiError`.
 */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { auth = true, ...opts } = init;
  if (!auth) return rawRequest<T>(path, opts);

  await ensureGuest();
  let token = getAccessToken();
  try {
    return await rawRequest<T>(path, { ...opts, bearer: token });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    // Another caller may already have rotated the tokens while this request was in flight.
    const latest = getAccessToken();
    if (latest && latest !== token) token = latest;
    else if (await refreshSession()) token = getAccessToken();
    else throw e;
    if (!token) throw e;
    return rawRequest<T>(path, { ...opts, bearer: token });
  }
}
