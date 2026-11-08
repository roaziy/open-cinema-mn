import { afterEach, describe, expect, it, vi } from 'vitest';
import { bffHeaders, clientIp, clientOf } from '../lib/bff';

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

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1.15';

describe('bffHeaders', () => {
  it('forwards the user-agent unchanged even without a secret', () => {
    vi.stubEnv('BFF_SECRET', '');
    expect(bffHeaders({ ip: '203.0.113.7', userAgent: UA })).toEqual({ 'user-agent': UA });
  });

  it('sends the secret, the address and the user-agent together', () => {
    vi.stubEnv('BFF_SECRET', 's3cret');
    expect(bffHeaders({ ip: '203.0.113.7', userAgent: UA })).toEqual({
      'user-agent': UA,
      'x-oc-bff-secret': 's3cret',
      'x-oc-client-ip': '203.0.113.7',
    });
    expect(bffHeaders({ ip: null, userAgent: null })).toEqual({ 'x-oc-bff-secret': 's3cret' });
  });
});

describe('clientOf', () => {
  it('reads the address and the original user-agent from the incoming request', () => {
    const h = new Headers({ 'x-forwarded-for': '198.51.100.2', 'user-agent': UA });
    expect(clientOf(h)).toEqual({ ip: '198.51.100.2', userAgent: UA });
    vi.stubEnv('BFF_SECRET', 's3cret');
    expect(bffHeaders(clientOf(h))['user-agent']).toBe(UA);
  });
});
