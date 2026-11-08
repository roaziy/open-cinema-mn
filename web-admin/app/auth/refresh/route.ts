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
import { clientOf } from '@/lib/bff';

/**
 * Where server components send the browser when the access token is gone or rejected. Rotates the
 * tokens (cookies can be written here) and returns to the page. Read-only apart from that: ending
 * a session is a POST (`endSession`), never a link.
 */
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get('next'), '/admin');
  const login = loginPathFor(next);
  const to = (path: string) => new URL(path, req.url);

  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  const expired = () => {
    // The API already refused this token (or there was none), so there is nothing left to revoke.
    const res = NextResponse.redirect(to(`${login}?error=expired`));
    clearAuthCookies(res.cookies);
    return res;
  };
  if (!refreshToken) return expired();

  const result = await refreshSession(refreshToken, clientOf(req.headers));
  if (!result.ok) {
    // Superseded: a parallel request just rotated it. Cookies are kept, the newer one arrives.
    if (result.reason === 'invalid') return expired();
    if (result.reason === 'superseded') {
      const res = NextResponse.redirect(to(next));
      markRefreshed(res.cookies); // loop guard: if the page still gets 401, the session is dead
      return res;
    }
    return NextResponse.redirect(to(`${login}?error=unavailable`));
  }
  const res = NextResponse.redirect(to(next));
  setAuthCookies(res.cookies, result.tokens, readClaims(result.tokens.accessToken)?.exp);
  markRefreshed(res.cookies);
  return res;
}
