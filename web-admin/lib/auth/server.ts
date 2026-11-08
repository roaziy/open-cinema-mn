import 'server-only';
import { type AuthTokens, AuthTokensSchema } from '@open-cinema/shared';
import { headers } from 'next/headers';
import { bffHeaders, clientIp } from '../bff';
import { apiUrl } from '../env';

export type ApiOutcome<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

/** Unauthenticated POST to the API from a server action. Never throws. */
export async function postJson(path: string, body: unknown): Promise<ApiOutcome<unknown>> {
  try {
    const res = await fetch(`${apiUrl()}/v1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bffHeaders(clientIp(await headers())) },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const text = await res.text();
      return { ok: true, data: text ? JSON.parse(text) : null };
    }
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: res.status, code: err.error ?? 'unknown' };
  } catch {
    return { ok: false, status: 0, code: 'unreachable' };
  }
}

export async function postForTokens(path: string, body: unknown): Promise<ApiOutcome<AuthTokens>> {
  const out = await postJson(path, body);
  if (!out.ok) return out;
  const parsed = AuthTokensSchema.safeParse(out.data);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, status: 502, code: 'bad_response' };
}
