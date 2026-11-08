import { describe, expect, it } from 'vitest';
import { clickToStart, hourTicks, nowOffset, place, rangeFor } from '../lib/timeline';

describe('timeline', () => {
  it('defaults to 10:00-24:00 and widens for late shows', () => {
    expect(rangeFor([])).toEqual({ fromMin: 600, toMin: 1440 });
    expect(rangeFor([{ startMin: 22 * 60, endMin: 25 * 60 + 10 }])).toEqual({
      fromMin: 600,
      toMin: 26 * 60,
    });
    expect(rangeFor([{ startMin: 9 * 60 + 30, endMin: 11 * 60 }]).fromMin).toBe(9 * 60);
  });

  it('places blocks as percentages and clips to the window', () => {
    const r = { fromMin: 600, toMin: 1440 };
    expect(place({ startMin: 600, endMin: 720 }, r)).toEqual({ left: 0, width: (120 / 840) * 100 });
    const clipped = place({ startMin: 1400, endMin: 1500 }, r);
    expect(clipped.left + clipped.width).toBeCloseTo(100);
  });

  it('puts the now line only inside the window', () => {
    const r = { fromMin: 600, toMin: 1440 };
    expect(nowOffset(480, r)).toBeNull();
    expect(nowOffset(1020, r)).toBeCloseTo(50);
  });

  it('labels each hour, wrapping past midnight', () => {
    const t = hourTicks({ fromMin: 22 * 60, toMin: 26 * 60 });
    expect(t.map((x) => x.label)).toEqual(['22:00', '23:00', '00:00', '01:00', '02:00']);
    expect(t[0]?.left).toBe(0);
    expect(t.at(-1)?.left).toBe(100);
  });

  it('maps a click to a start time, rolling past midnight into the next day', () => {
    const r = { fromMin: 10 * 60, toMin: 26 * 60 };
    expect(clickToStart('2026-11-08', 0, r)).toEqual({ date: '2026-11-08', time: '10:00' });
    expect(clickToStart('2026-11-08', 0.5, r)).toEqual({ date: '2026-11-08', time: '18:00' });
    // 00:30 sits at (24.5 - 10) / 16 of the track
    expect(clickToStart('2026-11-08', 14.5 / 16, r)).toEqual({ date: '2026-11-09', time: '00:30' });
    expect(clickToStart('2026-12-31', 15 / 16, r)).toEqual({ date: '2027-01-01', time: '01:00' });
    expect(clickToStart('2026-11-08', 7, r).date).toBe('2026-11-09');
  });
});
