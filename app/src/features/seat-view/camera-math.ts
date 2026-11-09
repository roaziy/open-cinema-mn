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

/** Near/far for a camera at this altitude: far-away views get a far near plane (depth precision). */
export const POV_NEAR_M = 0.1;
export function lensRange(altitudeM: number): { near: number; far: number } {
  return { near: Math.max(POV_NEAR_M, (altitudeM - 8) * 0.35), far: altitudeM + 150 };
}

/** The 2D map's content pixels as a linear function of hall metres: px = x0 + ppmX * x_m, py = y0 + ppmY * y_m. */
export type MapFit = { x0: number; ppmX: number; y0: number; ppmY: number };

type FitSlot = { seat: { x_m: number; y_m: number }; left: number; top: number };

/**
 * How the seat grid sits in the 2D map's content box. Columns follow x_m exactly (ppm is the
 * layout's pixels per metre); rows are evenly stacked on the phone, so the vertical scale is
 * the least-squares fit of the seats' row centres against y_m.
 */
export function mapFitOf(
  slots: readonly FitSlot[],
  size: number,
  ppm: number,
  origin: { x: number; y: number },
): MapFit {
  const first = slots[0];
  if (!first) return { x0: 0, ppmX: ppm || 1, y0: 0, ppmY: ppm || 1 };
  const cx = (s: FitSlot) => origin.x + s.left + size / 2;
  const cy = (s: FitSlot) => origin.y + s.top + size / 2;
  const x0 = cx(first) - ppm * first.seat.x_m;
  const n = slots.length;
  let sy = 0;
  let sp = 0;
  for (const s of slots) {
    sy += s.seat.y_m;
    sp += cy(s);
  }
  const my = sy / n;
  const mp = sp / n;
  let num = 0;
  let den = 0;
  for (const s of slots) {
    num += (s.seat.y_m - my) * (cy(s) - mp);
    den += (s.seat.y_m - my) ** 2;
  }
  const ppmY = den > 1e-9 && num > 0 ? num / den : ppm;
  return { x0, ppmX: ppm, y0: mp - ppmY * my, ppmY };
}

/** The 2D map's pan/zoom at this moment (viewport px; the content box is centred in the viewport). */
export type MapView = {
  scale: number;
  tx: number;
  ty: number;
  viewW: number;
  viewH: number;
  contentW: number;
  contentH: number;
};

export type TopDownPose = {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Multiplies the projection's vertical scale so the hall's rows fall on the 2D map's row pitch. */
  squash: number;
};

/** Field of view of the near-orthographic start view. */
export const TOP_FOV_DEG = 14;
/** How high above the seats the near-orthographic start camera stays at least. */
const TOP_DISTANCE_M = 90;
/** Seat tops sit this far above a seat's z_m (cushion and backrest, seen from above). */
export const SEAT_TOP_M = 0.6;

/** Height of the plane the 2D map is matched on: the raked floor's mean height plus the seat tops. */
export function seatPlaneHeight(seats: readonly { z_m: number }[]): number {
  if (seats.length === 0) return SEAT_TOP_M;
  let sum = 0;
  for (const s of seats) sum += s.z_m;
  return sum / seats.length + SEAT_TOP_M;
}

/**
 * Straight-down camera whose picture lines up with the 2D seat map: same px per metre, same
 * position, screen at the top. `canvas` is the 3D canvas in px; `offset` is where the 2D
 * viewport's top-left corner sits inside it.
 */
export function topDownFromMap(args: {
  fit: MapFit;
  view: MapView;
  canvasW: number;
  canvasH: number;
  offsetX: number;
  offsetY: number;
  fovDeg?: number;
  /** Height of the plane that is matched to the map (see seatPlaneHeight). */
  planeY: number;
}): TopDownPose {
  const { fit, view: v, canvasW, canvasH, offsetX, offsetY } = args;
  const f = v.scale * fit.ppmX;
  // Zoomed in, a 14 degree lens would sit close enough for the seats' heights to shift the
  // picture sideways: narrow it so the camera stays about TOP_DISTANCE_M above the seats.
  const fov =
    args.fovDeg ??
    Math.min(
      TOP_FOV_DEG,
      Math.max(1.5, (2 * Math.atan(canvasH / 2 / (f * TOP_DISTANCE_M)) * 180) / Math.PI),
    );
  const fy = canvasH / 2 / Math.tan((fov * Math.PI) / 360);
  const px0 = offsetX + v.viewW / 2 + v.tx + v.scale * (fit.x0 - v.contentW / 2);
  const py0 = offsetY + v.viewH / 2 + v.ty + v.scale * (fit.y0 - v.contentH / 2);
  const x = (canvasW / 2 - px0) / f;
  const z = (canvasH / 2 - py0) / (v.scale * fit.ppmY);
  const height = args.planeY + fy / f;
  return {
    position: [x, height, z],
    target: [x, 0, z],
    fov,
    squash: fit.ppmY / fit.ppmX,
  };
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

const smooth = (a: number, b: number, x: number) => {
  'worklet';
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Public so the scene can time its own fades to the same dive. */
export const smoothstep = smooth;

/** The look target leaves the hall for the screen only in the last part of the dive. */
const TARGET_FROM = 0.45;

export type DivePose = {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  squash: number;
};

export function newDivePose(): DivePose {
  return { position: [0, 0, 0], target: [0, 0, 0], up: [0, 1, 0], fov: 0, squash: 1 };
}

const TOP_UP: Vec3 = [0, 0, -1];

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l;
  v[1] /= l;
  v[2] /= l;
  return v;
}

/**
 * The dive from the top-down pose (s = 0) to the seat (s = 1), as a camera that looks at a point
 * from a distance. The log of that distance and the log of tan(fov/2) are interpolated together,
 * so the hall's apparent size changes steadily instead of shrinking and then jumping. The camera
 * swings from straight above to the seat's direction; the look target stays in the hall and
 * moves to the screen centre late. Writes into `out` (no allocation besides two tiny tuples).
 */
export function divePose(
  s: number,
  top: TopDownPose,
  eye: Vec3,
  center: Vec3,
  povFovDeg: number,
  out: DivePose,
): DivePose {
  const k = Math.min(1, Math.max(0, s));
  const d0 = Math.max(1e-3, top.position[1] - top.target[1]);
  const back1 = norm([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const d1 = Math.max(1e-3, Math.hypot(eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]));
  const u = smooth(TARGET_FROM, 1, k);
  const back = norm([back1[0] * k, 1 - k + back1[1] * k, back1[2] * k]);
  const d = Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * k);
  const t = out.target;
  t[0] = top.target[0] + (center[0] - top.target[0]) * u;
  t[1] = top.target[1] + (center[1] - top.target[1]) * u;
  t[2] = top.target[2] + (center[2] - top.target[2]) * u;
  out.position[0] = t[0] + back[0] * d;
  out.position[1] = t[1] + back[1] * d;
  out.position[2] = t[2] + back[2] * d;
  const up = norm([TOP_UP[0] * (1 - k), TOP_UP[1] * (1 - k) + k, TOP_UP[2] * (1 - k)]);
  out.up[0] = up[0];
  out.up[1] = up[1];
  out.up[2] = up[2];
  const tan0 = Math.tan((top.fov * Math.PI) / 360);
  const tan1 = Math.tan((povFovDeg * Math.PI) / 360);
  const tan = Math.exp(Math.log(tan0) + (Math.log(tan1) - Math.log(tan0)) * k);
  out.fov = (2 * Math.atan(tan) * 180) / Math.PI;
  out.squash = top.squash + (1 - top.squash) * k;
  return out;
}
