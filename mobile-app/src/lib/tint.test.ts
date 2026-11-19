import { describe, expect, it } from 'vitest';
import { tintedCanvas } from './tint';

describe('tintedCanvas', () => {
  it('mixes the tone into the canvas', () => {
    // #0B0B0D = (11,11,13); mixing 16% of pure blue (0,0,255)
    expect(tintedCanvas('#0000FF')).toBe('#090934');
  });

  it('keeps white tones dark', () => {
    const out = tintedCanvas('#FFFFFF');
    const lum = Number.parseInt(out.slice(1, 3), 16);
    expect(lum).toBeLessThan(80);
  });

  it('accepts short hex and no hash', () => {
    expect(tintedCanvas('#f00')).toBe(tintedCanvas('ff0000'));
  });

  it('falls back to the canvas for invalid tones', () => {
    expect(tintedCanvas('orange')).toBe('#0B0B0D');
  });

  it('clamps the amount', () => {
    expect(tintedCanvas('#FFFFFF', 5)).toBe(tintedCanvas('#FFFFFF', 0.3));
    expect(tintedCanvas('#FFFFFF', -1)).toBe('#0B0B0D');
  });
});
