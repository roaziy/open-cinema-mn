import { describe, expect, it } from 'vitest';
import { avoidOrange, pickTone, readableOn, TONE_PRESETS } from '../lib/tone';

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

  it('never returns an orange tone from a poster', () => {
    const tone = pickTone(px(240, 140, 30, 200));
    const hue = hueOf(tone);
    expect(hue < 12 || hue > 42).toBe(true);
  });
});

const hueOf = (hex: string) => {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe('tone helpers', () => {
  it('shifts orange but leaves red, yellow and grey alone', () => {
    expect(avoidOrange('#F28A1E')).not.toBe('#F28A1E');
    expect(avoidOrange('#F4C542')).toBe('#F4C542');
    expect(avoidOrange('#FF5A5F')).toBe('#FF5A5F');
    expect(avoidOrange('#808080')).toBe('#808080');
  });

  it('keeps no orange in the presets', () => {
    for (const c of TONE_PRESETS) expect(avoidOrange(c)).toBe(c);
  });

  it('picks dark text on light tones and white on dark ones', () => {
    expect(readableOn('#F4C542')).toBe('#0B0B0D');
    expect(readableOn('#2E6BF0')).toBe('#FFFFFF');
    expect(readableOn('#7E1416')).toBe('#FFFFFF');
  });
});
