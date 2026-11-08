import { afterEach, describe, expect, it, vi } from 'vitest';
import { bffHeaders, clientIp } from '../lib/bff';

afterEach(() => vi.unstubAllEnvs());

describe('clientIp', () => {
  it('prefers x-real-ip, then the first x-forwarded-for entry', () => {
    expect(
      clientIp(new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' })),
    ).toBe('203.0.113.7');
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe(
      '198.51.100.2',
    );
    expect(clientIp(new Headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('ignores missing or malformed values', () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ 'x-forwarded-for': 'evil, <script>' }))).toBeNull();
  });
});

describe('bffHeaders', () => {
  it('sends nothing without a secret', () => {
    vi.stubEnv('BFF_SECRET', '');
    expect(bffHeaders('203.0.113.7')).toEqual({});
  });

  it('sends the secret and the address together', () => {
    vi.stubEnv('BFF_SECRET', 's3cret');
    expect(bffHeaders('203.0.113.7')).toEqual({
      'x-oc-bff-secret': 's3cret',
      'x-oc-client-ip': '203.0.113.7',
    });
    expect(bffHeaders(null)).toEqual({ 'x-oc-bff-secret': 's3cret' });
  });
});
