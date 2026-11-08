import { describe, expect, it } from 'vitest';
import { isSameOrigin } from '../lib/csrf';

const h = (init: Record<string, string>) => new Headers(init);

describe('isSameOrigin', () => {
  it('trusts Sec-Fetch-Site same-origin only', () => {
    expect(isSameOrigin(h({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOrigin(h({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isSameOrigin(h({ 'sec-fetch-site': 'same-site' }))).toBe(false);
    expect(isSameOrigin(h({ 'sec-fetch-site': 'none' }))).toBe(false);
  });

  it('lets Sec-Fetch-Site win over a matching Origin', () => {
    expect(
      isSameOrigin(h({ 'sec-fetch-site': 'cross-site', origin: 'https://a.test', host: 'a.test' })),
    ).toBe(false);
  });

  it('falls back to Origin against the host', () => {
    expect(isSameOrigin(h({ origin: 'https://a.test', host: 'a.test' }))).toBe(true);
    expect(isSameOrigin(h({ origin: 'https://evil.test', host: 'a.test' }))).toBe(false);
    expect(
      isSameOrigin(
        h({ origin: 'https://a.test', host: 'internal:3000', 'x-forwarded-host': 'a.test' }),
      ),
    ).toBe(true);
  });

  it('refuses a request with neither header, or a bad Origin', () => {
    expect(isSameOrigin(h({ host: 'a.test' }))).toBe(false);
    expect(isSameOrigin(h({ origin: 'not a url', host: 'a.test' }))).toBe(false);
    expect(isSameOrigin(h({ origin: 'null', host: 'a.test' }))).toBe(false);
  });
});
