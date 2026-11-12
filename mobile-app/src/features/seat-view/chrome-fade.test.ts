import { describe, expect, it } from 'vitest';
import { CHROME_FULL_UNTIL, CHROME_GONE_AT, chromeOpacity, footerSlide } from './chrome-fade';

describe('chromeOpacity', () => {
  it('stays fully visible through the first part of the dive', () => {
    for (const d of [0, 0.1, 0.2, CHROME_FULL_UNTIL]) expect(chromeOpacity(d, 1, false)).toBe(1);
  });
  it('is gone from the middle of the dive on', () => {
    for (const d of [CHROME_GONE_AT, 0.8, 1]) expect(chromeOpacity(d, 1, false)).toBe(0);
  });
  it('fades steadily in between, and the closing dive (progress running down) fades it back in', () => {
    let prev = 1;
    for (let i = 0; i <= 20; i++) {
      const o = chromeOpacity(
        CHROME_FULL_UNTIL + ((CHROME_GONE_AT - CHROME_FULL_UNTIL) * i) / 20,
        1,
        false,
      );
      expect(o).toBeLessThanOrEqual(prev);
      prev = o;
    }
    // closing: progress 1 -> 0 passes the same range backwards: back to 1 by CHROME_FULL_UNTIL
    expect(chromeOpacity(0.5, 1, false)).toBeGreaterThan(0);
    expect(chromeOpacity(0.5, 1, false)).toBeLessThan(1);
    expect(chromeOpacity(CHROME_FULL_UNTIL, 1, false)).toBe(1);
  });
  it('does not depend on the crossfade in a normal dive', () => {
    expect(chromeOpacity(0.1, 0, false)).toBe(1);
    expect(chromeOpacity(0.1, 1, false)).toBe(1);
  });
  it('follows the crossfade with Reduce Motion', () => {
    expect(chromeOpacity(0, 0, true)).toBe(1);
    expect(chromeOpacity(1, 0.5, true)).toBe(0.5);
    expect(chromeOpacity(1, 1, true)).toBe(0);
  });
});

describe('footerSlide', () => {
  it('is 0 while shown and slides down as it fades', () => {
    expect(footerSlide(0, 0, false)).toBe(0);
    expect(footerSlide(0.5, 1, false)).toBeGreaterThan(0);
    expect(footerSlide(1, 1, false)).toBe(24);
  });
});
