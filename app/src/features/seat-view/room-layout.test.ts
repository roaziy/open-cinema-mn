import { describe, expect, it } from 'vitest';
import { aisleCentres, aisleStrips, slatLayout } from './room-layout';

describe('slatLayout', () => {
  it('alternates two shades along the wall and stays inside it', () => {
    const slats = slatLayout(12);
    expect(slats.length).toBeGreaterThan(8);
    expect(slats.map((s) => s.shade).slice(0, 4)).toEqual([0, 1, 0, 1]);
    expect(Math.min(...slats.map((s) => s.z))).toBeGreaterThanOrEqual(1);
    expect(Math.max(...slats.map((s) => s.z))).toBeLessThan(12);
  });
});

describe('aisleCentres', () => {
  it('finds the gap between two blocks of seats', () => {
    const xs = [-3.3, -2.75, -2.2, -1.65, 1.1, 1.65, 2.2, 2.75, 3.3];
    expect(aisleCentres(xs)).toHaveLength(1);
    expect(aisleCentres(xs)[0]).toBeCloseTo(-0.275);
  });
  it('finds none in a hall without an aisle', () => {
    expect(aisleCentres([0, 0.55, 1.1, 1.65])).toEqual([]);
  });
});

describe('aisleStrips', () => {
  it('puts a light per row at each aisle and both side walls', () => {
    const rows = [
      { label: 'A', y: 4, z: 0 },
      { label: 'B', y: 5, z: 0.3 },
    ];
    const strips = aisleStrips(rows, [0], 4);
    expect(strips).toHaveLength(2 * 3);
    expect(strips.some((s) => s.x === 0)).toBe(true);
    expect(strips.some((s) => s.x === -3.65)).toBe(true);
    // on the front edge of its row's step: between the rows ahead and itself
    expect(strips[3]?.z).toBeCloseTo(4.5 + 0.07);
  });
});
