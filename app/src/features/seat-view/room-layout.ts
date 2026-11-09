import type { Row } from './camera-math';

/** Vertical acoustic slats along a side wall: z centres, one every `pitch` m, in two alternating shades. */
export function slatLayout(depthM: number, pitch = 0.9, margin = 1) {
  const out: { z: number; shade: 0 | 1 }[] = [];
  for (let z = margin, i = 0; z < depthM - margin * 0.6; z += pitch, i++) {
    out.push({ z, shade: (i % 2) as 0 | 1 });
  }
  return out;
}

/** x of the aisles: the middle of every gap between seat columns wider than a seat and a half. */
export function aisleCentres(seatXs: readonly number[]): number[] {
  const xs = [...new Set(seatXs.map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);
  let pitch = Number.POSITIVE_INFINITY;
  for (let i = 1; i < xs.length; i++) {
    pitch = Math.min(pitch, (xs[i] as number) - (xs[i - 1] as number));
  }
  const out: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1] as number;
    const b = xs[i] as number;
    if (b - a > pitch * 1.5) out.push((a + b) / 2);
  }
  return out;
}

export type Strip = { x: number; z: number; y: number };

/**
 * Small step lights: one per row at every aisle and along both side walls, on the front edge of
 * the row's step (halfway to the row before it).
 */
export function aisleStrips(
  rows: readonly Row[],
  aisles: readonly number[],
  halfWidthM: number,
): Strip[] {
  const xs = [...aisles, -(halfWidthM - 0.35), halfWidthM - 0.35];
  const out: Strip[] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const z = prev ? (prev.y + r.y) / 2 : Math.max(0.5, r.y - 0.6);
    for (const x of xs) out.push({ x, z: z + 0.07, y: Math.max(r.z, 0.05) + 0.02 });
  });
  return out;
}

// ---- Keeping the camera out of the furniture -------------------------------------------------

type SeatPos = { id?: string; x_m: number; y_m: number; z_m: number };
type Step = { from: number; to: number; height: number };

/** Seat footprint half-sizes (x, z) and height: cushion, armrests and headrest. */
const SEAT_HALF_X = 0.27;
const SEAT_HALF_Z = 0.28;
const SEAT_HEIGHT = 1.1;
/** How far above the seats the camera travels, and how close to the eye it may come down. */
const CLEAR_M = 0.5;
const DESCEND_FROM_M = 0.15;
const DESCEND_TO_M = 0.95;

export type Obstacles = {
  half: number;
  depth: number;
  wallH: number;
  steps: readonly Step[];
  seats: readonly SeatPos[];
};

export const seatHeightM = SEAT_HEIGHT;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function stepHeightAt(o: Obstacles, z: number): number {
  for (const s of o.steps) if (z >= s.from && z <= s.to) return s.height;
  return 0;
}

/** Top of whatever stands at (x, z): the step, plus the seats on it. */
export function topAt(o: Obstacles, x: number, z: number): number {
  let top = stepHeightAt(o, z);
  for (const s of o.seats) {
    if (Math.abs(x - s.x_m) < SEAT_HALF_X + 0.3 && Math.abs(z - s.y_m) < SEAT_HALF_Z + 0.3) {
      top = Math.max(top, s.z_m + SEAT_HEIGHT);
    }
  }
  return top;
}

/**
 * Where the dive's position really goes: never below the seats and steps until it is close to
 * the eye, and inside the walls once it is below the ceiling. `eyeA`/`eyeB` are the places the
 * camera may come down to (the dive's seat; for a hop both seats).
 */
export function clearPosition(
  pos: readonly [number, number, number],
  eyeA: readonly [number, number, number],
  eyeB: readonly [number, number, number] | null,
  o: Obstacles,
  out: [number, number, number],
): [number, number, number] {
  // Inside the room's walls once low enough to be seen from inside.
  const k = clamp01((o.wallH + 2 - pos[1]) / 2);
  const x = pos[0] + (Math.min(o.half - 0.3, Math.max(-(o.half - 0.3), pos[0])) - pos[0]) * k;
  const z = pos[2] + (Math.min(o.depth - 0.3, Math.max(0.3, pos[2])) - pos[2]) * k;
  const dist = (e: readonly [number, number, number]) => Math.hypot(x - e[0], z - e[2]);
  const h = Math.min(dist(eyeA), eyeB ? dist(eyeB) : Number.POSITIVE_INFINITY);
  const w = Math.sqrt(smooth(DESCEND_FROM_M, DESCEND_TO_M, h));
  const lifted = Math.max(pos[1], topAt(o, x, z) + CLEAR_M);
  out[0] = x;
  out[1] = pos[1] + (lifted - pos[1]) * w;
  out[2] = z;
  return out;
}

/** True when a camera with this near-plane radius at `p` is inside a seat, a step or a wall. */
export function insideGeometry(
  p: readonly [number, number, number],
  o: Obstacles,
  radius: number,
  skipSeat?: (s: SeatPos) => boolean,
): boolean {
  const [x, y, z] = p;
  if (y < radius) return true;
  for (const s of o.steps) {
    if (z >= s.from - radius && z <= s.to + radius && y < s.height + radius) return true;
  }
  if (y < o.wallH) {
    if (Math.abs(x) > o.half - radius || z < radius || z > o.depth - radius) return true;
  }
  for (const s of o.seats) {
    if (skipSeat?.(s)) continue;
    if (
      Math.abs(x - s.x_m) < SEAT_HALF_X + radius &&
      Math.abs(z - s.y_m) < SEAT_HALF_Z + radius &&
      y > s.z_m - radius &&
      y < s.z_m + SEAT_HEIGHT + radius
    ) {
      return true;
    }
  }
  return false;
}
