import { type NextRequest, NextResponse } from 'next/server';
import { readClaims } from '@/lib/auth/claims';
import {
  clearAuthCookies,
  markRefreshed,
  REFRESH_COOKIE,
  setAuthCookies,
} from '@/lib/auth/cookies';
import { loginPathFor, safeNext } from '@/lib/auth/redirects';
import { refreshSession } from '@/lib/auth/refresh';

/**
 * Where server components send the browser when the access token is gone or rejected.
 * Rotates the tokens (cookies can be written here) and returns to the page.
 * `signout=1` drops the session instead and lands on the right login page.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const next = safeNext(params.get('next'), '/admin');
  const login = loginPathFor(next);
  const back = (path: string, query = '') => new URL(`${path}${query}`, req.url);

  const fail = (reason: string) => {
    const res = NextResponse.redirect(
      back(next.endsWith('/login') ? next : login, `?error=${reason}`),
    );
    clearAuthCookies(res.cookies);
    return res;
  };

  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (params.get('signout') === '1') return fail(params.get('error') ?? 'expired');
  if (!refreshToken) return fail('expired');

  const result = await refreshSession(refreshToken);
  if (!result.ok) {
    if (result.reason === 'unavailable') {
      return NextResponse.redirect(back(login, '?error=unavailable'));
    }
    return fail('expired');
  }
  const res = NextResponse.redirect(back(next));
  setAuthCookies(res.cookies, result.tokens, readClaims(result.tokens.accessToken)?.exp);
  markRefreshed(res.cookies);
  return res;
}
