/**
 * The API sees only this server's address, so per-IP rate limits would share one bucket. Every
 * server-side API call therefore carries the real client address, vouched for by a shared secret
 * (BFF_SECRET) that the API checks before it trusts the address. Without the secret nothing is
 * sent and the API falls back to the socket address (local development).
 */
const IP_SHAPE = /^[0-9a-f:.]{3,45}$/i;

/**
 * The address is trusted only because Vercel's edge overwrites `x-real-ip` and `x-forwarded-for`
 * with the connecting client's address. Behind a proxy that appends instead, a visitor could
 * choose the value (and dodge per-IP limits): do not deploy this BFF there without changing it.
 */
export function clientIp(headers: Headers): string | null {
  const candidate =
    headers.get('x-real-ip')?.trim() || headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return candidate && IP_SHAPE.test(candidate) ? candidate : null;
}

/** What the API needs to know about the end user behind this server's request. */
export type Client = { ip: string | null; userAgent: string | null };

export function clientOf(headers: Headers): Client {
  return { ip: clientIp(headers), userAgent: headers.get('user-agent') };
}

/**
 * The user-agent always goes along, unchanged: the API binds the refresh grace window to the
 * caller's address plus user-agent, and without it a parallel refresh would sign the user out.
 */
export function bffHeaders(client: Client): Record<string, string> {
  const out: Record<string, string> = {};
  if (client.userAgent) out['user-agent'] = client.userAgent;
  const secret = process.env.BFF_SECRET;
  if (secret) {
    out['x-oc-bff-secret'] = secret;
    if (client.ip) out['x-oc-client-ip'] = client.ip;
  }
  return out;
}
