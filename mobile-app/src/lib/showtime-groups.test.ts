import { describe, expect, it } from 'vitest';
import type { BranchShowtimes } from '@/shared';
import { groupByBranch } from './showtime-groups';

const slot = {
  id: 's',
  startsAt: '',
  format: '2D',
  priceStandard: 1,
  pricePremium: 1,
  seatsLeft: 1,
  capacity: 1,
  hallName: 'A',
} as const;
const branch = (id: string, n: number): BranchShowtimes => ({
  branch: { id, name: id, address: '', lat: 0, lng: 0 },
  showtimes: Array.from({ length: n }, () => ({ ...slot })),
});

describe('groupByBranch', () => {
  it('drops branches without shows', () => {
    expect(groupByBranch([branch('a', 0), branch('b', 1)], null).map((b) => b.branch.id)).toEqual([
      'b',
    ]);
  });

  it('puts the preferred branch first and keeps the rest in order', () => {
    const out = groupByBranch([branch('a', 1), branch('b', 1), branch('c', 1)], 'c');
    expect(out.map((b) => b.branch.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps API order with no preference', () => {
    expect(groupByBranch([branch('b', 1), branch('a', 1)], null).map((b) => b.branch.id)).toEqual([
      'b',
      'a',
    ]);
  });
});
