import { formatMnt } from '@open-cinema/shared';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  compact,
  count,
  dayMonth,
  dayPrefix,
  deltaPct,
  isDate,
  minutesIntoDay,
  pct,
  ubInstant,
  weekdayMn,
} from '../lib/format';

describe('counts', () => {
  it('groups like money does (commas)', () => {
    expect(count(1200)).toBe('1,200');
    expect(count(999)).toBe('999');
    expect(formatMnt(25000)).toBe('₮25,000');
    expect(pct(0.724)).toBe('72%');
    expect(compact(1_500_000)).toBe('1.5M');
    expect(compact(25_000)).toBe('25K');
    expect(compact(800)).toBe('800');
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

  it('labels a showing that is not today', () => {
    const today = '2026-11-08';
    expect(dayPrefix('2026-11-08T11:00:00Z', today)).toBe('');
    expect(dayPrefix('2026-11-08T17:00:00Z', today)).toBe('Маргааш'); // 01:00 on the 9th in UB
    expect(dayPrefix('2026-11-09T07:00:00Z', today)).toBe('Маргааш');
    expect(dayPrefix('2026-11-13T07:00:00Z', today)).toBe('11-13');
  });

  it('validates date strings', () => {
    expect(isDate('2026-11-08')).toBe(true);
    expect(isDate('2026-13-45')).toBe(false);
    expect(isDate('2026-02-30')).toBe(false);
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
