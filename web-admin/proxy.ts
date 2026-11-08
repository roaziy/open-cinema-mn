import { type NextRequest, NextResponse } from 'next/server';
import { isFresh, readClaims } from './lib/auth/claims';
import {
  ACCESS_COOKIE,
  clearAuthCookies,
  REFRESH_COOKIE,
  setAuthCookies,
  type Tokens,
} from './lib/auth/cookies';
import { homeFor } from './lib/auth/redirects';
import { refreshSession, revokeSession } from './lib/auth/refresh';
import { clientOf } from './lib/bff';

/**
 * The one place that refreshes ahead of time (pages and `/api/*` alike), so the access token a
 * server component or route handler sees is never expired and the refresh token is spent in one
 * module instance only. It also routes on the (unverified) role claim; authority stays with the
 * API and `requireRole`.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname === '/api' || pathname.startsWith('/api/');
  const isLogin = pathname === '/login' || pathname === '/staff/login';
  const isAdminArea = pathname === '/admin' || pathname.startsWith('/admin/');
  // A login page opened because a session ended must not bounce a still-stored session back in.
  const endingSession = isLogin && req.nextUrl.searchParams.has('error');

  const client = clientOf(req.headers);
  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  let rotated: Tokens | null = null;
  let drop = false;
  let stalled = false;

  if (!isFresh(access) && refresh) {
    const result = await refreshSession(refresh, client);
    if (result.ok) {
      rotated = result.tokens;
      access = result.tokens.accessToken;
    } else if (result.reason === 'invalid') {
      access = undefined;
      drop = true;
    } else {
      // Superseded or unreachable: keep the cookies as they are. A parallel request holds the
      // newer pair, or the API is down; either way this request carries on without a refresh.
      stalled = true;
    }
  }

  const finish = (res: NextResponse) => {
    if (rotated) setAuthCookies(res.cookies, rotated, readClaims(rotated.accessToken)?.exp);
    if (drop) clearAuthCookies(res.cookies);
    return res;
  };
  const redirectTo = (path: string, query?: Record<string, string>) => {
    const url = new URL(path, req.url);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    return finish(NextResponse.redirect(url));
  };
  const forward = (extra?: Record<string, string>) => {
    if (rotated) {
      // Let this very request's handlers see the rotated tokens.
      req.cookies.set(ACCESS_COOKIE, rotated.accessToken);
      req.cookies.set(REFRESH_COOKIE, rotated.refreshToken);
    } else if (drop) {
      // The API refused these; handlers must not present them again.
      req.cookies.delete(ACCESS_COOKIE);
      req.cookies.delete(REFRESH_COOKIE);
    }
    const headers = new Headers(req.headers);
    for (const [k, v] of Object.entries(extra ?? {})) headers.set(k, v);
    return finish(NextResponse.next({ request: { headers } }));
  };

  if (isApi) return forward();

  const role = readClaims(access)?.role;
  const home = homeFor(role);

  if (isLogin) return home && !endingSession ? redirectTo(home) : forward();

  // Nobody to ask for a new token right now. A token that has not expired still works.
  if (stalled && !isFresh(access, 0)) {
    return new NextResponse('Түр хүлээгээд дахин оролдоно уу.', {
      status: 503,
      headers: { 'retry-after': '2', 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const loginPath = isAdminArea ? '/login' : '/staff/login';
  if (!role) return redirectTo(loginPath, { next: pathname + req.nextUrl.search });
  const allowed = isAdminArea ? role === 'admin' : role === 'staff' || role === 'admin';
  if (!allowed) {
    // Staff wandering into /admin go home; any other role has no business here at all.
    if (isAdminArea && role === 'staff') return redirectTo('/staff');
    drop = true;
    const stored = rotated?.refreshToken ?? refresh;
    if (stored) await revokeSession(stored, client);
    return redirectTo(loginPath, { error: 'forbidden' });
  }

  return forward({ 'x-pathname': pathname + req.nextUrl.search });
}

export const config = { matcher: ['/admin/:path*', '/staff/:path*', '/login', '/api/:path*'] };
