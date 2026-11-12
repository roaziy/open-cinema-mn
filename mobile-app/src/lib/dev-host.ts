const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** `192.168.1.5:8081` or `exp://192.168.1.5:8081` -> `192.168.1.5`; null when unusable. */
export function hostFromHostUri(hostUri: string | null | undefined): string | null {
  if (!hostUri) return null;
  const rest = hostUri.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0] ?? '';
  const host = rest.startsWith('[') ? rest.slice(0, rest.indexOf(']') + 1) : rest.split(':')[0];
  return host && !LOOPBACK.has(host) ? host : null;
}

/**
 * In development a phone cannot reach the dev machine through `localhost`: swap a loopback API
 * host for the machine Metro is served from (same port). Anything else is returned untouched.
 */
export function resolveApiOrigin(
  configured: string,
  opts: { dev: boolean; hostUri?: string | null },
): string {
  if (!opts.dev) return configured;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return configured;
  }
  if (!LOOPBACK.has(url.hostname)) return configured;
  const lan = hostFromHostUri(opts.hostUri);
  if (!lan) return configured;
  url.hostname = lan;
  return url.toString().replace(/\/+$/, '');
}

/**
 * Media (poster, backdrop) URLs come from the backend as absolute links to its public host,
 * `http://localhost:8080/...` in development: a phone cannot load those. Same rule as the API
 * origin, but the path, query and port stay as they are.
 */
export function devMediaUrl(url: string, opts: { dev: boolean; hostUri?: string | null }): string {
  if (!opts.dev) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!LOOPBACK.has(parsed.hostname)) return url;
  const lan = hostFromHostUri(opts.hostUri);
  if (!lan) return url;
  parsed.hostname = lan;
  return parsed.toString();
}
