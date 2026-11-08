/**
 * First path segments the browser may reach through `/api/*`. Anything not listed (notably
 * `auth`, which issues tokens) is refused. Express routes case-insensitively, so segments are
 * compared lowercased and forwarded lowercased.
 */
export const PROXIED = new Set([
  'me',
  'branches',
  'movies',
  'showtimes',
  'holds',
  'bookings',
  'tickets',
  'payments',
  'staff',
  'admin',
]);

import { hasControlChars } from './auth/redirects';

const BACKSLASH = String.fromCharCode(92);

/** `/v1/...` path for the API, or null when the request must not be forwarded. */
export function upstreamPath(segments: string[]): string | null {
  const [first, ...rest] = segments;
  if (!first || !PROXIED.has(first.toLowerCase())) return null;
  const all = [first.toLowerCase(), ...rest];
  if (
    all.some(
      (s) =>
        s === '' ||
        s === '.' ||
        s === '..' ||
        s.includes('/') ||
        s.includes(BACKSLASH) ||
        hasControlChars(s),
    )
  ) {
    return null;
  }
  return `/v1/${all.map(encodeURIComponent).join('/')}`;
}
