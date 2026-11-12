/** Identity hues (never used for actions). Each section, branch and person keeps one. */
export const HUES = {
  green: '#30C46B',
  red: '#FF5A5F',
  purple: '#8B5CF6',
  teal: '#14B8A6',
  yellow: '#F5C542',
  pink: '#EC4899',
  indigo: '#5B6CFF',
  sky: '#38BDF8',
} as const;

export type HueKey = keyof typeof HUES;

/** Branches and people cycle through these; red is kept for "needs attention". */
const CYCLE: HueKey[] = ['purple', 'teal', 'pink', 'sky', 'yellow', 'indigo', 'green'];

/** A stable hue for any id: the same branch or person gets the same color in every app. */
export function hueFor(seed: string): HueKey {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CYCLE[h % CYCLE.length] as HueKey;
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

/** Shifts an orange tone to the nearer neighbour (red below the middle, yellow above). Upper-cases the result. */
export function avoidOrange(hex: string): string {
  const [h, s, l] = hexToHsl(hex);
  if (s < 0.12 || h <= ORANGE_FROM || h >= ORANGE_TO) return hex.toUpperCase();
  return hslToHex(h < (ORANGE_FROM + ORANGE_TO) / 2 ? 6 : 46, s, l);
}
