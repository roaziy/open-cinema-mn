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
    return `#${hex(best.r / best.w)}${hex(best.g / best.w)}${hex(best.b / best.w)}`.toUpperCase();
  }
  if (n === 0) return '#2E6BF0';
  return `#${hex(ar / n)}${hex(ag / n)}${hex(ab / n)}`.toUpperCase();
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
  '#E63B2E',
  '#F5C542',
  '#30C46B',
  '#14B8A6',
  '#38BDF8',
  '#3B7C99',
] as const;
