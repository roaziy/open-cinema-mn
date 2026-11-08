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

/** A stable hue for any id: the same branch or person always gets the same color. */
export function hueFor(seed: string): HueKey {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CYCLE[h % CYCLE.length] as HueKey;
}

export function initials(name: string | null | undefined, fallback = '?'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = parts[0] as string;
  const second = parts[1];
  return ([...first][0] + (second ? [...second][0] : '')).toLocaleUpperCase('mn');
}

/**
 * Hues for a set of ids: each id starts at its own stable hue and moves on to the next free one
 * if another id already holds it, so neighbours in a list never look alike while they fit.
 */
export function assignHues(ids: string[]): Map<string, HueKey> {
  const taken = new Set<HueKey>();
  const out = new Map<string, HueKey>();
  for (const id of [...ids].sort()) {
    const start = CYCLE.indexOf(hueFor(id));
    let pick = CYCLE[start] as HueKey;
    for (let i = 0; i < CYCLE.length; i++) {
      const candidate = CYCLE[(start + i) % CYCLE.length] as HueKey;
      if (!taken.has(candidate)) {
        pick = candidate;
        break;
      }
    }
    taken.add(pick);
    out.set(id, pick);
  }
  return out;
}
