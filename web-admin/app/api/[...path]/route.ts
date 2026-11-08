import { type NextRequest, NextResponse } from 'next/server';
import { readClaims } from '@/lib/auth/claims';
import {
  ACCESS_COOKIE,
  clearAuthCookies,
  REFRESH_COOKIE,
  setAuthCookies,
  type Tokens,
} from '@/lib/auth/cookies';
import { refreshSession } from '@/lib/auth/refresh';
import { bffHeaders, clientOf } from '@/lib/bff';
import { isSameOrigin } from '@/lib/csrf';
import { apiUrl } from '@/lib/env';
import { upstreamPath } from '@/lib/proxy-path';

/**
 * Backend-for-frontend proxy for client components: `/api/<path>` -> `API_INTERNAL_URL/v1/<path>`.
 * The browser only ever holds httpOnly cookies; this adds the bearer. `proxy.ts` refreshes ahead
 * of time (it is the only module that does), so here a 401 gets at most one retry with a rotated
 * pair. Only allowlisted API areas are reachable; token-issuing endpoints are not.
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

async function handle(req: NextRequest, { params }: Ctx): Promise<Response> {
  const method = req.method;
  if (method !== 'GET' && !isSameOrigin(req.headers)) return json(403, 'bad_origin');

  const { path } = await params;
  const target = upstreamPath(path);
  if (!target) return json(404, 'not_found');
  const url = `${apiUrl()}${target}${req.nextUrl.search}`;

  const forwarded = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = req.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  const client = clientOf(req.headers);
  for (const [k, v] of Object.entries(bffHeaders(client))) forwarded.set(k, v);
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
    const result = await refreshSession(refreshToken, client);
    if (result.ok) {
      rotated = result.tokens;
      access = result.tokens.accessToken;
      return true;
    }
    // Only a refused token ends the session. `superseded` means a newer cookie is on its way.
    expired = result.reason === 'invalid';
    return false;
  };

  try {
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
