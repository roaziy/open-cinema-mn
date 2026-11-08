import { describe, expect, it } from 'vitest';
import {
  checkCode,
  signLink,
  signPassUrl,
  signQr,
  verifyCheckCode,
  verifyLink,
  verifyPassSig,
  verifyQr,
} from '../src/lib/sign';

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

describe('guest link signing', () => {
  it('round-trips and rejects tampering and the QR format', () => {
    const token = signLink(T);
    expect(token).toMatch(/^ol1\.[^.]+\.[A-Za-z0-9_-]+$/);
    expect(verifyLink(token)).toBe(T);
    expect(verifyLink(token.replace(T, S))).toBeNull();
    expect(verifyLink(`${token}x`)).toBeNull();
    expect(verifyLink(signQr(T, S))).toBeNull();
    expect(verifyQr(token)).toBeNull();
    expect(verifyLink('')).toBeNull();
  });
});

describe('pass url signing', () => {
  const now = new Date('2026-11-08T10:00:00Z');
  const parse = (url: string) => {
    const u = new URL(url, 'http://x');
    return { exp: Number(u.searchParams.get('exp')), sig: u.searchParams.get('sig') ?? '' };
  };

  it('is valid for five minutes, then expires', () => {
    const url = signPassUrl(T, now);
    expect(url).toMatch(new RegExp(`^/v1/tickets/${T}/pass\\?exp=\\d+&sig=`));
    const { exp, sig } = parse(url);
    expect(verifyPassSig(T, exp, sig, new Date(now.getTime() + 299_000))).toBe(true);
    expect(verifyPassSig(T, exp, sig, new Date(now.getTime() + 301_000))).toBe(false);
  });

  it('is bound to the ticket and the expiry', () => {
    const { exp, sig } = parse(signPassUrl(T, now));
    expect(verifyPassSig(S, exp, sig, now)).toBe(false);
    expect(verifyPassSig(T, exp + 600, sig, now)).toBe(false);
    expect(verifyPassSig(T, exp, `${sig}x`, now)).toBe(false);
  });
});

describe('ticket check code', () => {
  it('is 4 Crockford characters, deterministic and per ticket', () => {
    const a = checkCode(T);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(checkCode(T)).toBe(a);
    const codes = new Set(
      Array.from({ length: 200 }, (_, i) =>
        checkCode(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
      ),
    );
    expect(codes.size).toBeGreaterThan(190);
    expect(checkCode(S)).not.toBe(a);
  });

  it('depends on the secret', () => {
    expect(checkCode(T, 'another secret entirely')).not.toBe(checkCode(T));
  });

  it('verifies any case and folds look-alikes, and rejects anything else', () => {
    const c = checkCode(T);
    expect(verifyCheckCode(T, c)).toBe(true);
    expect(verifyCheckCode(T, c.toLowerCase())).toBe(true);
    expect(verifyCheckCode(S, c)).toBe(false);
    expect(verifyCheckCode(T, '')).toBe(false);
    expect(verifyCheckCode(T, `${c}0`)).toBe(false);
    const flipped = (c[0] === 'A' ? 'B' : 'A') + c.slice(1);
    expect(verifyCheckCode(T, flipped)).toBe(false);
  });
});
