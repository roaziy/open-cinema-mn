import { colors } from '@/theme/tokens';

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  const h = m?.[1];
  if (!h) return null;
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The page colour for a film: its tone mixed into the canvas. `amount` is capped so the result
 * stays dark enough for light text, even for a white tone. Invalid tones fall back to the canvas.
 */
export function tintedCanvas(tone: string, amount = 0.16, base: string = colors.canvas): string {
  const t = parseHex(tone);
  const b = parseHex(base);
  if (!b) return base;
  if (!t) return `#${b.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  const a = Math.min(Math.max(amount, 0), 0.3);
  const mix = t.map((v, i) => Math.round((b[i] as number) * (1 - a) + v * a));
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
