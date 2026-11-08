import { describe, expect, it } from 'vitest';
import {
  addDays,
  count,
  dayMonth,
  deltaPct,
  isDate,
  minutesIntoDay,
  mnt,
  pct,
  ubInstant,
  weekdayMn,
} from '../lib/format';

const T = String.fromCharCode(0x2009);

describe('money and counts', () => {
  it('groups thousands with a thin space (U+2009)', () => {
    expect(mnt(25000)).toBe(`25${T}000₮`);
    expect(mnt(0)).toBe('0₮');
    expect(mnt(1234567)).toBe(`1${T}234${T}567₮`);
    expect(mnt(-4500)).toBe(`−4${T}500₮`);
    expect(count(1200)).toBe(`1${T}200`);
    expect(pct(0.724)).toBe('72%');
  });
});

describe('Ulaanbaatar days', () => {
  it('converts wall-clock time to the UTC instant (UTC+8)', () => {
    expect(ubInstant('2026-11-08', '10:30')).toBe('2026-11-08T02:30:00.000Z');
    expect(ubInstant('2026-11-08', '00:15')).toBe('2026-11-07T16:15:00.000Z');
  });

  it('measures minutes into the local day, including past midnight', () => {
    expect(minutesIntoDay('2026-11-08', '2026-11-08T02:30:00Z')).toBe(630);
    expect(minutesIntoDay('2026-11-08', '2026-11-08T17:00:00Z')).toBe(25 * 60);
  });

  it('adds days across month ends and names weekdays', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayMn('2026-11-08')).toBe('Ням');
    expect(dayMonth('2026-11-08')).toBe('11-р сарын 8');
  });

  it('validates date strings', () => {
    expect(isDate('2026-11-08')).toBe(true);
    expect(isDate('2026-13-45')).toBe(false);
    expect(isDate('nope')).toBe(false);
    expect(isDate(undefined)).toBe(false);
  });
});

describe('deltaPct', () => {
  it('compares to a baseline and refuses a zero baseline', () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(10, 0)).toBeNull();
  });
});
