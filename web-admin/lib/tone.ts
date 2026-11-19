import { avoidOrange, pickTone } from '@/lib/shared';

export { avoidOrange, pickTone };

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
