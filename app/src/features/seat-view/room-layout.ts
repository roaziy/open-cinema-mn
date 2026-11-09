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
