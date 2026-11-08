import { generateSeats } from '@open-cinema/shared';
import { describe, expect, it } from 'vitest';
import { bounds, DEFAULT_GEN, inferGen, parseAisles, sameGen } from '../lib/hall-layout';

describe('inferGen', () => {
  it('recovers the parameters a hall was generated from', () => {
    const gen = {
      rows: 6,
      seatsPerRow: 12,
      seatPitchM: 0.6,
      rowSpacingM: 1.1,
      aisleAfter: [4, 8],
      firstRowDistanceM: 3.5,
      risePerRowM: 0.25,
    };
    const back = inferGen(generateSeats(gen));
    expect(back).not.toBeNull();
    expect(sameGen(back as typeof gen, gen)).toBe(true);
  });

  it('handles a single row and an empty hall', () => {
    const one = inferGen(generateSeats({ ...DEFAULT_GEN, rows: 1 }));
    expect(one?.rows).toBe(1);
    expect(one?.risePerRowM).toBe(0);
    expect(inferGen([])).toBeNull();
  });
});

describe('helpers', () => {
  it('parses aisle lists, dropping junk and duplicates', () => {
    expect(parseAisles('7, 3; 7 x 0 -2 4.5')).toEqual([3, 7]);
    expect(parseAisles('')).toEqual([]);
  });

  it('finds seat bounds', () => {
    expect(
      bounds([
        { x_m: -2, y_m: 3 },
        { x_m: 4, y_m: 9 },
      ]),
    ).toEqual({
      minX: -2,
      maxX: 4,
      minY: 3,
      maxY: 9,
    });
  });
});
