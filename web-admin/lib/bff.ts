/**
 * The API sees only this server's address, so per-IP rate limits would share one bucket. Every
 * server-side API call therefore carries the real client address, vouched for by a shared secret
 * (BFF_SECRET) that the API checks before it trusts the address. Without the secret nothing is
 * sent and the API falls back to the socket address (local development).
 */
const IP_SHAPE = /^[0-9a-f:.]{3,45}$/i;

export function clientIp(headers: Headers): string | null {
  const candidate =
    headers.get('x-real-ip')?.trim() || headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return candidate && IP_SHAPE.test(candidate) ? candidate : null;
}

export function bffHeaders(ip: string | null): Record<string, string> {
  const secret = process.env.BFF_SECRET;
  if (!secret) return {};
  return ip ? { 'x-oc-bff-secret': secret, 'x-oc-client-ip': ip } : { 'x-oc-bff-secret': secret };
}
