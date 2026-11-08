import { EYE_HEIGHT_M, SCREEN_BOTTOM_M } from '@open-cinema/shared';

/**
 * Pure maths for the view-from-seat scene. World axes follow three.js (Y up): world x is the
 * hall's x_m, world y is height (z_m), world z is distance from the screen (y_m). The screen
 * sits at z = 0 facing +z, so a seat looks toward -z.
 */
export type Vec3 = [number, number, number];

type SeatPos = { x_m: number; y_m: number; z_m: number };
type HallDims = { screen_width_m: number; screen_height_m: number; screen_x_m: number };

export const FLY_MS = 1500;

/** Ease-in-out (cubic), clamped to 0..1. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Eased progress of a flight; with Reduce Motion the camera jumps straight to the end. */
export function flightProgress(elapsedMs: number, reduceMotion: boolean, durationMs = FLY_MS) {
  if (reduceMotion) return 1;
  return easeInOut(elapsedMs / durationMs);
}

/** Camera position for a seat: its position raised by the eye height. */
export function eyePosition(seat: SeatPos): Vec3 {
  return [seat.x_m, seat.z_m + EYE_HEIGHT_M, seat.y_m];
}

/** The point every seat looks at: the middle of the screen. */
export function screenCenter(hall: HallDims): Vec3 {
  return [hall.screen_x_m, SCREEN_BOTTOM_M + hall.screen_height_m / 2, 0];
}

export type Extents = { minX: number; maxX: number; minY: number; maxY: number; maxZ: number };

export function hallExtents(seats: readonly SeatPos[]): Extents {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = 0;
  for (const s of seats) {
    if (s.x_m < minX) minX = s.x_m;
    if (s.x_m > maxX) maxX = s.x_m;
    if (s.y_m < minY) minY = s.y_m;
    if (s.y_m > maxY) maxY = s.y_m;
    if (s.z_m > maxZ) maxZ = s.z_m;
  }
  if (!Number.isFinite(minX)) return { minX: -1, maxX: 1, minY: 1, maxY: 2, maxZ: 0 };
  return { minX, maxX, minY, maxY, maxZ };
}

/** Half the hall's width: the wider of the seats and the screen, plus a margin for the walls. */
export function hallHalfWidth(ext: Extents, hall: HallDims): number {
  const seats = Math.max(Math.abs(ext.minX), Math.abs(ext.maxX));
  return Math.max(seats + 1.2, hall.screen_width_m / 2 + 0.6);
}

/** Height from which the whole hall (screen wall to back wall) fits the view, looking straight down. */
export function topDownHeight(
  halfWidthM: number,
  depthM: number,
  fovDeg: number,
  aspect: number,
): number {
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  const forDepth = depthM / 2 / tan;
  const forWidth = halfWidthM / (tan * Math.max(aspect, 0.1));
  return Math.max(forDepth, forWidth) * 1.08;
}

/** Straight-down camera over the middle of the hall (depth = screen wall to back wall). */
export function topDownPosition(
  ext: Extents,
  hall: HallDims,
  fovDeg: number,
  aspect: number,
): { position: Vec3; target: Vec3 } {
  const depth = hallDepth(ext);
  const half = hallHalfWidth(ext, hall);
  const h = topDownHeight(half, depth, fovDeg, aspect);
  return { position: [0, h, depth / 2], target: [0, 0, depth / 2] };
}

/** Write a -> b at progress t into `out` (no allocation). */
export function lerp3(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

export type ScreenSource = { kind: 'remote'; url: string } | { kind: 'flat'; color: string };

const HEX = /^#[0-9a-fA-F]{6}$/;
const NEUTRAL_TONE = '#8E8E93';

/** Screen content: the backdrop, else the poster, else a flat film-tone colour. */
export function pickScreenSource(movie: {
  backdropUrl: string | null;
  posterUrl: string;
  tone: string;
}): ScreenSource {
  const url = movie.backdropUrl || movie.posterUrl;
  if (url) return { kind: 'remote', url };
  return { kind: 'flat', color: HEX.test(movie.tone) ? movie.tone : NEUTRAL_TONE };
}

/** Film tone, or neutral grey when the server sent something that is not #rrggbb. */
export function safeTone(tone: string): string {
  return HEX.test(tone) ? tone : NEUTRAL_TONE;
}

/**
 * Vertical field of view that keeps a wide horizontal view on a portrait canvas: aim for
 * ~80 degrees across, but never fisheye (vertical capped at 85) or telephoto (floor at 50).
 */
export function fovForAspect(aspect: number): number {
  const a = Math.max(aspect, 0.1);
  const v = (2 * Math.atan(Math.tan((80 * Math.PI) / 360) / a) * 180) / Math.PI;
  return Math.min(85, Math.max(50, v));
}

/** Texture repeat/offset that crops an image to fill (cover) a plane of another aspect. */
export function coverTransform(imageAspect: number, planeAspect: number) {
  if (!(imageAspect > 0) || !(planeAspect > 0)) return { rx: 1, ry: 1, ox: 0, oy: 0 };
  if (imageAspect > planeAspect) {
    const rx = planeAspect / imageAspect;
    return { rx, ry: 1, ox: (1 - rx) / 2, oy: 0 };
  }
  const ry = imageAspect / planeAspect;
  return { rx: 1, ry, ox: 0, oy: (1 - ry) / 2 };
}

/** Screen wall to back wall: the deepest seat plus a margin. */
export function hallDepth(ext: Extents): number {
  return ext.maxY + 1.5;
}

export type Row = { label: string; y: number; z: number };

/** One entry per row, nearest the screen first. Curved halls use the row's mean position. */
export function rowsOf(seats: readonly (SeatPos & { rowLabel: string })[]): Row[] {
  const byRow = new Map<string, { y: number; z: number; n: number }>();
  for (const s of seats) {
    const r = byRow.get(s.rowLabel) ?? { y: 0, z: 0, n: 0 };
    r.y += s.y_m;
    r.z += s.z_m;
    r.n++;
    byRow.set(s.rowLabel, r);
  }
  return [...byRow.entries()]
    .map(([label, r]) => ({ label, y: r.y / r.n, z: r.z / r.n }))
    .sort((a, b) => a.y - b.y);
}

export type StepSpan = { from: number; to: number; height: number };

const MIN_STEP_M = 0.05;

/** Floor step per row: it owns the stretch halfway to its neighbours (first from the screen wall, last to the back wall). */
export function stepSpans(rows: readonly Row[], depth: number): StepSpan[] {
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    return {
      from: prev ? (prev.y + r.y) / 2 : 0,
      to: next ? (r.y + next.y) / 2 : depth,
      height: Math.max(r.z, MIN_STEP_M),
    };
  });
}

/** Largest texture side we will upload: the GPU limit, capped (posters are never this big). */
export function textureFits(width: number, height: number, maxTextureSize: number, cap = 4096) {
  const limit = Math.min(maxTextureSize > 0 ? maxTextureSize : cap, cap);
  return width > 0 && height > 0 && Math.max(width, height) <= limit;
}
