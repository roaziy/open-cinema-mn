import { describe, expect, it } from 'vitest';
import { pickTone } from '../lib/tone';

const px = (r: number, g: number, b: number, n: number, a = 255) =>
  Array.from({ length: n }).flatMap(() => [r, g, b, a]);

describe('pickTone', () => {
  it('prefers the dominant saturated color over a larger dark area', () => {
    const data = [...px(10, 10, 10, 400), ...px(200, 40, 40, 120), ...px(40, 60, 200, 30)];
    const tone = pickTone(data);
    const r = Number.parseInt(tone.slice(1, 3), 16);
    const b = Number.parseInt(tone.slice(5, 7), 16);
    expect(r).toBeGreaterThan(150);
    expect(b).toBeLessThan(100);
  });

  it('falls back to the plain average for a grey poster', () => {
    expect(pickTone(px(100, 100, 100, 50))).toBe('#646464');
  });

  it('ignores transparent pixels and returns the action blue for an empty image', () => {
    expect(pickTone(px(255, 0, 0, 50, 0))).toBe('#2E6BF0');
    expect(pickTone([])).toBe('#2E6BF0');
  });

  it('always returns a 7-char hex', () => {
    expect(pickTone(px(30, 220, 90, 20))).toMatch(/^#[0-9A-F]{6}$/);
  });
});
