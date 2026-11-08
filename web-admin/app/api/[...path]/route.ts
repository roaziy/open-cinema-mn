import { type NextRequest, NextResponse } from 'next/server';
import { isFresh, readClaims } from '@/lib/auth/claims';
import {
  ACCESS_COOKIE,
  clearAuthCookies,
  REFRESH_COOKIE,
  setAuthCookies,
  type Tokens,
} from '@/lib/auth/cookies';
import { refreshSession } from '@/lib/auth/refresh';
import { isSameOrigin } from '@/lib/csrf';
import { API_URL } from '@/lib/env';

/**
 * Backend-for-frontend proxy for client components: `/api/<path>` -> `API_INTERNAL_URL/v1/<path>`.
 * The browser only ever holds httpOnly cookies; this adds the bearer, refreshes on 401 and
 * rotates the cookie. Token-issuing endpoints are not reachable here.
 */
export const dynamic = 'force-dynamic';

const FORWARD_REQUEST = [
  'accept',
  'accept-language',
  'content-type',
  'if-none-match',
  'if-match',
  'idempotency-key',
  'last-event-id',
];
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // fetch() already decoded the body, so these no longer describe it.
  'content-encoding',
  'content-length',
  'set-cookie',
];

type Ctx = { params: Promise<{ path: string[] }> };

const json = (status: number, error: string) => NextResponse.json({ error }, { status });

function upstreamUrl(segments: string[], search: string): string | null {
  if (segments.length === 0 || segments[0] === 'auth') return null;
  if (segments.some((s) => s === '' || s === '.' || s === '..' || /[\\/]/.test(s))) return null;
  return `${API_URL}/v1/${segments.map(encodeURIComponent).join('/')}${search}`;
}

async function handle(req: NextRequest, { params }: Ctx): Promise<Response> {
  const method = req.method;
  if (method !== 'GET' && !isSameOrigin(req.headers)) return json(403, 'bad_origin');

  const { path } = await params;
  const url = upstreamUrl(path, req.nextUrl.search);
  if (!url) return json(404, 'not_found');

  const forwarded = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = req.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  const ip = req.headers.get('x-forwarded-for');
  if (ip) forwarded.set('x-forwarded-for', ip);
  const body = method === 'GET' ? undefined : await req.arrayBuffer();

  const send = (access: string | undefined) => {
    const headers = new Headers(forwarded);
    if (access) headers.set('authorization', `Bearer ${access}`);
    return fetch(url, {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal: req.signal,
    });
  };

  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  let rotated: Tokens | null = null;
  let expired = false;

  const rotate = async () => {
    if (!refreshToken) return false;
    const result = await refreshSession(refreshToken);
    if (result.ok) {
      rotated = result.tokens;
      access = result.tokens.accessToken;
      return true;
    }
    expired = result.reason === 'invalid';
    return false;
  };

  try {
    if (!isFresh(access) && refreshToken) await rotate();
    let upstream = await send(access);
    if (upstream.status === 401 && !rotated && (await rotate())) upstream = await send(access);

    const headers = new Headers(upstream.headers);
    for (const name of HOP_BY_HOP) headers.delete(name);
    const noBody = upstream.status === 204 || upstream.status === 304;
    const res = new NextResponse(noBody ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
    const next = rotated as Tokens | null;
    if (next) setAuthCookies(res.cookies, next, readClaims(next.accessToken)?.exp);
    if (expired && upstream.status === 401) clearAuthCookies(res.cookies);
    return res;
  } catch {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return json(502, 'upstream_unavailable');
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
