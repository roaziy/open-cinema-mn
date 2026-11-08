import { IS_PROD } from '../env';

export const ACCESS_COOKIE = 'oc_at';
export const REFRESH_COOKIE = 'oc_rt';
/** Short-lived marker: a refresh just happened. Stops refresh loops when the API keeps saying 401. */
export const REFRESHED_COOKIE = 'oc_rf';

const REFRESH_MAX_AGE_S = 30 * 24 * 60 * 60;
const ACCESS_FALLBACK_AGE_S = 15 * 60;

export type Tokens = { accessToken: string; refreshToken: string };

type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
};

/** The write half shared by `cookies()` (server actions) and `NextResponse.cookies`. */
export type CookieJar = {
  set(name: string, value: string, options: CookieOptions): unknown;
};

const options = (maxAge: number): CookieOptions => ({
  httpOnly: true,
  secure: IS_PROD,
  sameSite: 'lax',
  path: '/',
  maxAge,
});

export function setAuthCookies(jar: CookieJar, tokens: Tokens, accessExp?: number | null): void {
  const accessAge = accessExp
    ? Math.max(1, accessExp - Math.floor(Date.now() / 1000))
    : ACCESS_FALLBACK_AGE_S;
  jar.set(ACCESS_COOKIE, tokens.accessToken, options(accessAge));
  jar.set(REFRESH_COOKIE, tokens.refreshToken, options(REFRESH_MAX_AGE_S));
}

export function clearAuthCookies(jar: CookieJar): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, REFRESHED_COOKIE]) {
    jar.set(name, '', options(0));
  }
}

export function markRefreshed(jar: CookieJar): void {
  jar.set(REFRESHED_COOKIE, '1', options(20));
}
