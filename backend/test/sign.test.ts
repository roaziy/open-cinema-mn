import { describe, expect, it } from 'vitest';
import { signQr, verifyQr } from '../src/lib/sign';

const T = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

describe('QR signing', () => {
  it('round-trips and has the oc1 format', () => {
    const token = signQr(T, S);
    expect(token).toMatch(/^oc1\.[^.]+\.[^.]+\.[A-Za-z0-9_-]+$/);
    expect(verifyQr(token)).toEqual({ ticketId: T, showtimeId: S });
  });

  it('rejects tampering, truncation and other prefixes', () => {
    const token = signQr(T, S);
    expect(verifyQr(token.replace(T, S))).toBeNull();
    expect(verifyQr(`${token}x`)).toBeNull();
    expect(verifyQr(token.slice(0, -2))).toBeNull();
    expect(verifyQr(token.replace('oc1', 'oc2'))).toBeNull();
    expect(verifyQr('')).toBeNull();
  });
});
