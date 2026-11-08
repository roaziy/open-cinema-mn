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
import { refreshSession } from './lib/auth/refresh';

/**
 * Optimistic gate: routes on the (unverified) role claim and keeps the access token fresh so
 * server components never see an expired one. Authority stays with the API and `requireRole`.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isLogin = pathname === '/login' || pathname === '/staff/login';
  const isAdminArea = pathname === '/admin' || pathname.startsWith('/admin/');

  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  let rotated: Tokens | null = null;
  let drop = false;

  if (!isFresh(access) && refresh) {
    const result = await refreshSession(refresh);
    if (result.ok) {
      rotated = result.tokens;
      access = result.tokens.accessToken;
    } else if (result.reason === 'invalid') {
      access = undefined;
      drop = true;
    } else if (!isLogin) {
      return new NextResponse('Серверт холбогдож чадсангүй. Түр хүлээгээд дахин оролдоно уу.', {
        status: 503,
        headers: { 'retry-after': '5', 'content-type': 'text/plain; charset=utf-8' },
      });
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

  const role = readClaims(access)?.role;
  const home = homeFor(role);

  if (isLogin) {
    return home ? redirectTo(home) : finish(NextResponse.next());
  }

  const loginPath = isAdminArea ? '/login' : '/staff/login';
  if (!role) {
    return redirectTo(loginPath, { next: pathname + req.nextUrl.search });
  }
  const allowed = isAdminArea ? role === 'admin' : role === 'staff' || role === 'admin';
  if (!allowed) {
    // Staff wandering into /admin go home; any other role has no business here at all.
    if (isAdminArea && role === 'staff') return redirectTo('/staff');
    drop = true;
    return redirectTo(loginPath, { error: 'forbidden' });
  }

  if (rotated) {
    // Let this very request's server components see the rotated tokens.
    req.cookies.set(ACCESS_COOKIE, rotated.accessToken);
    req.cookies.set(REFRESH_COOKIE, rotated.refreshToken);
  }
  const headers = new Headers(req.headers);
  headers.set('x-pathname', pathname + req.nextUrl.search);
  return finish(NextResponse.next({ request: { headers } }));
}

export const config = { matcher: ['/admin/:path*', '/staff/:path*', '/login'] };
