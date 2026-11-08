/**
 * The BFF authenticates with cookies, so state-changing requests must come from this site.
 * Browsers always send Sec-Fetch-Site (or at least Origin) on fetch/XHR writes.
 */
export function isSameOrigin(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = headers.get('origin');
  if (!origin) return false;
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
