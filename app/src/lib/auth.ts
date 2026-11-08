import {
  type AuthTokens,
  AuthTokensSchema,
  type OtpChannel,
  type PublicUser,
  PublicUserSchema,
} from '@open-cinema/shared';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { ApiError, rawRequest } from './http';

// SecureStore keys: alphanumeric, ".", "-", "_" only.
const KEY_ACCESS = 'oc.access';
const KEY_REFRESH = 'oc.refresh';
const KEY_USER = 'oc.user';

type Session = { user: PublicUser; accessToken: string; refreshToken: string };
type AuthState = { ready: boolean; session: Session | null };

let state: AuthState = { ready: false, session: null };
/** Bumped whenever the session is replaced or cleared; lets in-flight work notice it is stale. */
let generation = 0;
const listeners = new Set<() => void>();

function setState(next: AuthState) {
  state = next;
  for (const l of listeners) l();
}

export function subscribeAuth(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// --- persistence (writes are serialized so an old write can never land after a newer one) ---

let persistChain: Promise<void> = Promise.resolve();

function persist(task: () => Promise<void>): Promise<void> {
  persistChain = persistChain.then(task).catch(() => {});
  return persistChain;
}

function persistSession(s: Session): Promise<void> {
  return persist(async () => {
    // Refresh token first: it is the one that must never be lost after rotation.
    await SecureStore.setItemAsync(KEY_REFRESH, s.refreshToken);
    await SecureStore.setItemAsync(KEY_ACCESS, s.accessToken);
    await SecureStore.setItemAsync(KEY_USER, JSON.stringify(s.user));
  });
}

function persistClear(): Promise<void> {
  return persist(async () => {
    await Promise.all(
      [KEY_REFRESH, KEY_ACCESS, KEY_USER].map((k) => SecureStore.deleteItemAsync(k)),
    );
  });
}

let hydrating: Promise<void> | null = null;

/** Load the saved session once. Every entry point awaits this first. */
export function hydrateAuth(): Promise<void> {
  hydrating ??= (async () => {
    let session: Session | null = null;
    try {
      const [accessToken, refreshToken, rawUser] = await Promise.all([
        SecureStore.getItemAsync(KEY_ACCESS),
        SecureStore.getItemAsync(KEY_REFRESH),
        SecureStore.getItemAsync(KEY_USER),
      ]);
      const user = rawUser ? PublicUserSchema.safeParse(JSON.parse(rawUser)) : null;
      if (accessToken && refreshToken && user?.success) {
        session = { accessToken, refreshToken, user: user.data };
      }
    } catch {
      session = null;
    }
    setState({ ready: true, session });
  })();
  return hydrating;
}

function applyTokens(tokens: AuthTokens): Promise<void> {
  generation++;
  const session: Session = {
    user: tokens.user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
  setState({ ready: true, session });
  return persistSession(session);
}

function clearSession(): Promise<void> {
  generation++;
  setState({ ready: true, session: null });
  return persistClear();
}

// --- public API ---

export function getAccessToken(): string | null {
  return state.session?.accessToken ?? null;
}

export function getUserId(): string | null {
  return state.session?.user.id ?? null;
}

let guestInFlight: Promise<PublicUser> | null = null;

/** Make sure a session exists, creating an anonymous guest if there is none. Single-flight. */
export async function ensureGuest(): Promise<PublicUser> {
  await hydrateAuth();
  if (state.session) return state.session.user;
  guestInFlight ??= (async () => {
    const tokens = AuthTokensSchema.parse(await rawRequest('/auth/guest', { method: 'POST' }));
    // A login may have completed while the guest request was in flight: keep that one.
    if (!state.session) await applyTokens(tokens);
    return (state.session as Session | null)?.user ?? tokens.user;
  })().finally(() => {
    guestInFlight = null;
  });
  return guestInFlight;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchange the refresh token for a new pair. One request is shared by all callers, so a
 * rotated token is never replayed. Resolves false when the session is gone (tokens are
 * cleared; the next `ensureGuest` starts a fresh guest). Throws on network/server errors,
 * keeping the tokens.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  await hydrateAuth();
  const current = state.session;
  if (!current) return false;
  const startedAt = generation;
  try {
    const tokens = AuthTokensSchema.parse(
      await rawRequest('/auth/refresh', {
        method: 'POST',
        json: { refreshToken: current.refreshToken },
      }),
    );
    // Logged out or signed in again while waiting: drop the result.
    if (startedAt !== generation) return false;
    await applyTokens(tokens);
    return true;
  } catch (e) {
    // 401 invalid_refresh (reuse detected, all sessions revoked) or refresh_expired.
    if (e instanceof ApiError && e.status === 401) {
      if (startedAt === generation) await clearSession();
      return false;
    }
    throw e;
  }
}

export async function requestOtp(channel: OtpChannel, target: string): Promise<void> {
  await rawRequest<void>('/auth/otp/request', { method: 'POST', json: { channel, target } });
}

export async function loginWithOtp(
  channel: OtpChannel,
  target: string,
  code: string,
): Promise<PublicUser> {
  await hydrateAuth();
  const tokens = AuthTokensSchema.parse(
    await rawRequest('/auth/otp/verify', { method: 'POST', json: { channel, target, code } }),
  );
  await applyTokens(tokens);
  return tokens.user;
}

/** Forget the session locally, then revoke it on the server (best effort, once). */
export async function logout(): Promise<void> {
  await hydrateAuth();
  // Let a refresh that is already on the wire finish so we revoke the newest token,
  // not one the server has just rotated away.
  if (refreshInFlight) await refreshInFlight.catch(() => {});
  const refreshToken = state.session?.refreshToken;
  await clearSession();
  if (!refreshToken) return;
  try {
    await rawRequest<void>('/auth/logout', { method: 'POST', json: { refreshToken } });
  } catch {}
}

export function useAuth() {
  const s = useSyncExternalStore(subscribeAuth, () => state);
  return {
    ready: s.ready,
    user: s.session?.user ?? null,
    ensureGuest,
    requestOtp,
    loginWithOtp,
    logout,
  };
}
