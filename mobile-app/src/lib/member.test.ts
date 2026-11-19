import { describe, expect, it } from 'vitest';
import { formatMemberNo, formatPoints, needsEmail, signedPoints } from './member';

describe('formatMemberNo', () => {
  it('groups the digits in threes', () => {
    expect(formatMemberNo(100001)).toBe('OC 100 001');
    expect(formatMemberNo(1234567)).toBe('OC 1 234 567');
  });
});

describe('points formatting', () => {
  it('uses thousands separators', () => {
    expect(formatPoints(4500)).toBe('4,500');
    expect(formatPoints(0)).toBe('0');
  });

  it('signs by direction only', () => {
    expect(signedPoints(120)).toBe('+120');
    expect(signedPoints(-1200)).toBe('−1,200');
    expect(signedPoints(0)).toBe('0');
  });
});

describe('needsEmail', () => {
  it('only asks signed-in customers without a verified email', () => {
    expect(needsEmail({ role: 'customer', emailVerified: false })).toBe(true);
    expect(needsEmail({ role: 'customer', emailVerified: true })).toBe(false);
    expect(needsEmail({ role: 'guest', emailVerified: false })).toBe(false);
    expect(needsEmail({ role: 'staff', emailVerified: false })).toBe(false);
    expect(needsEmail(null)).toBe(false);
  });
});
