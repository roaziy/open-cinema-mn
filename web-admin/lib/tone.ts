/**
 * Picks a film tone from poster pixels. Pixels are bucketed by hue-ish color; very dark, very
 * light and grey ones are ignored (they say nothing about the film's identity), and the heaviest
 * bucket's average wins. Falls back to a plain average when the poster is nearly monochrome.
 */
export function pickTone(rgba: ArrayLike<number>): string {
  const buckets = new Map<number, { r: number; g: number; b: number; w: number }>();
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i] as number;
    const g = rgba[i + 1] as number;
    const b = rgba[i + 2] as number;
    if ((rgba[i + 3] as number) < 200) continue;
    ar += r;
    ag += g;
    ab += b;
    n++;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (max < 50 || min > 215 || sat < 0.28) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const weight = 1 + sat * 2;
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, w: 0 };
    cur.r += r * weight;
    cur.g += g * weight;
    cur.b += b * weight;
    cur.w += weight;
    buckets.set(key, cur);
  }
  let best: { r: number; g: number; b: number; w: number } | null = null;
  for (const v of buckets.values()) if (!best || v.w > best.w) best = v;
  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  if (best && best.w > 0) {
    return avoidOrange(`#${hex(best.r / best.w)}${hex(best.g / best.w)}${hex(best.b / best.w)}`);
  }
  if (n === 0) return '#2E6BF0';
  return avoidOrange(`#${hex(ar / n)}${hex(ag / n)}${hex(ab / n)}`);
}

function hexToHsl(hex: string): [number, number, number] {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : [0, c, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/** Hues inside this band read as orange, which the product never shows. */
const ORANGE_FROM = 12;
const ORANGE_TO = 42;

/** Shifts an orange tone to the nearer neighbour (red below the middle, yellow above). */
export function avoidOrange(hex: string): string {
  const [h, s, l] = hexToHsl(hex);
  if (s < 0.12 || h <= ORANGE_FROM || h >= ORANGE_TO) return hex.toUpperCase();
  return hslToHex(h < (ORANGE_FROM + ORANGE_TO) / 2 ? 6 : 46, s, l);
}

/** Text colour that stays readable on a tone: dark ink on light tones, white on dark ones. */
export function readableOn(hex: string): string {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(Number.parseInt(hex.slice(1, 3), 16));
  const g = lin(Number.parseInt(hex.slice(3, 5), 16));
  const b = lin(Number.parseInt(hex.slice(5, 7), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#0B0B0D' : '#FFFFFF';
}

/** Loads an image file into a small canvas and suggests its tone. Client only. */
export async function suggestTone(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '#2E6BF0';
    ctx.drawImage(img, 0, 0, size, size);
    return pickTone(ctx.getImageData(0, 0, size, size).data);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const TONE_PRESETS = [
  '#2E6BF0',
  '#5B6CFF',
  '#8B5CF6',
  '#EC4899',
  '#FF5A5F',
  '#F5C542',
  '#30C46B',
  '#14B8A6',
  '#38BDF8',
  '#3B7C99',
] as const;
