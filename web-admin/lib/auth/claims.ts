export type Claims = { sub?: string; role?: string; exp?: number };

/**
 * Reads the payload of an access token WITHOUT verifying it (this app does not hold the signing
 * secret). Good enough to route and to time refreshes; the API stays the authority on every call.
 */
export function readClaims(token: string | undefined): Claims | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(b64)
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    const data = JSON.parse(json) as Record<string, unknown>;
    return {
      sub: typeof data.sub === 'string' ? data.sub : undefined,
      role: typeof data.role === 'string' ? data.role : undefined,
      exp: typeof data.exp === 'number' ? data.exp : undefined,
    };
  } catch {
    return null;
  }
}

/** True while the token has at least `skewMs` of life left. */
export function isFresh(token: string | undefined, skewMs = 15_000): boolean {
  const exp = readClaims(token)?.exp;
  return exp !== undefined && exp * 1000 > Date.now() + skewMs;
}
