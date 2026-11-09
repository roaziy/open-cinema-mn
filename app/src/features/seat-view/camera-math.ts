import { EYE_HEIGHT_M, SCREEN_BOTTOM_M } from '@open-cinema/shared';

/**
 * Pure maths for the view-from-seat scene. World axes follow three.js (Y up): world x is the
 * hall's x_m, world y is height (z_m), world z is distance from the screen (y_m). The screen
 * sits at z = 0 facing +z, so a seat looks toward -z.
 */
export type Vec3 = [number, number, number];

type SeatPos = { x_m: number; y_m: number; z_m: number };
type HallDims = { screen_width_m: number; screen_height_m: number; screen_x_m: number };

/** The longest a flight takes (see diveMs). */
export const FLY_MS = 3200;

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

/** Highest angular speed of the camera, degrees per second. */
export const MAX_TURN_DEG_PER_S = 90;
/** Peak of the speed profile of `easeFlight` (its largest slope). */
export const EASE_PEAK = 1.5;

export type DivePose = {
  position: Vec3;
  /** Heading about +Y, radians (0 looks toward -z, the screen). */
  yaw: number;
  /** Elevation, radians (-pi/2 looks straight down). Roll is always zero. */
  pitch: number;
  /** Vertical field of view, degrees. */
  fov: number;
  squash: number;
};

export function newDivePose(): DivePose {
  return { position: [0, 0, 0], yaw: 0, pitch: 0, fov: 0, squash: 1 };
}

/** Heading and elevation (no roll) of the direction from `from` to `to`. */
export function viewAngles(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.asin(dy / l) };
}

/** The unit view direction for a yaw and pitch (three's camera looks down -z). */
export function forwardOf(yaw: number, pitch: number, out: Vec3): Vec3 {
  out[0] = -Math.cos(pitch) * Math.sin(yaw);
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(pitch) * Math.cos(yaw);
  return out;
}

/**
 * The full angle between two orientations (heading and elevation, no roll), degrees. Unlike the
 * angle between view directions it counts the picture spinning while looking straight down.
 */
export function rotationAngleDeg(y1: number, p1: number, y2: number, p2: number): number {
  const cx = Math.cos(p1);
  const sx = Math.sin(p1);
  const dy = y2 - y1;
  const cd = Math.cos(dy);
  const cp = Math.cos(p2);
  const sp = Math.sin(p2);
  // trace of Rx(-p1) * Ry(dy) * Rx(p2), with Rx(-p1) = [[1,0,0],[0,cx,sx],[0,-sx,cx]]
  // and Ry(dy) * Rx(p2) = [[cd, sd*sp, sd*cp], [0, cp, -sp], [-sd, cd*sp, cd*cp]]
  const t0 = cd;
  const t1 = cx * cp + sx * cd * sp;
  const t2 = -sx * -sp + cx * cd * cp;
  const c = (t0 + t1 + t2 - 1) / 2;
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
}

/** One ease-in-out over the whole move (zero speed at both ends, no seams). */
export function easeFlight(t: number): number {
  return smooth(0, 1, t);
}

const logLerp = (a: number, b: number, t: number) =>
  Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
export const tanLerpDeg = (aDeg: number, bDeg: number, t: number) => {
  const ta = Math.tan((aDeg * Math.PI) / 360);
  const tb = Math.tan((bDeg * Math.PI) / 360);
  return (2 * Math.atan(logLerp(ta, tb, t)) * 180) / Math.PI;
};

export type Bounds = { half: number; depth: number };

/** Progress at which the look target starts to climb from the floor to the screen centre. */
export const B_FROM = 0.55;
/** The foot of the screen, where the opening look target passes on its way up. */
const SCREEN_FOOT_Z_M = 1;

/**
 * Orientation from where the camera is looking: the look target starts where the top-down
 * camera looks (on the floor), slides across the floor to the foot of the screen, and climbs to
 * the screen centre, arriving only as the camera reaches the eye. It always lies in the hall,
 * so the room stays in view the whole way; heading and elevation come from geometry (no roll).
 */
function aimAt(
  k: number,
  top: TopDownPose,
  out: DivePose,
  center: Vec3,
  end: number,
  eye: Vec3,
  held: number,
) {
  const a = smooth(0, 0.75, k);
  const b = smooth(B_FROM, 1, k);
  // The target stays on the seat block (the held seat) until it climbs to the screen: no frame
  // looks at the empty floor between the screen and the first row.
  // Opening keeps the approved aim (toward the foot of the screen); closing keeps the held seat.
  const gx = center[0] + (eye[0] - center[0]) * held;
  const gz = SCREEN_FOOT_Z_M + (eye[2] - SCREEN_FOOT_Z_M) * held;
  const x0 = top.target[0] + (gx - top.target[0]) * a;
  const z0 = top.target[2] + (gz - top.target[2]) * a;
  const tx = x0 + (center[0] - x0) * b;
  const ty = center[1] * b;
  const tz = z0 + (center[2] - z0) * b;
  const dx = tx - out.position[0];
  const dy = ty - out.position[1];
  const dz = tz - out.position[2];
  const pitch = Math.asin(dy / (Math.hypot(dx, dy, dz) || 1));
  // Looking almost straight down the heading is the picture spinning, and the geometric heading
  // there can even point backwards (the target is behind a front seat): turn evenly from the
  // start to the seat's final heading instead, finishing a little before the end.
  out.yaw = end * smooth(0, 0.9, k);
  out.pitch = pitch;
}

/** Where the second control point of the final approach sits: behind and above the eye, inside the room. */
export const APPROACH_BACK_M = 2;
export const APPROACH_UP_M = 1.2;
const WALL_INSET_M = 0.4;
/** Share of the top-down altitude the curve's first control point keeps over the seat. */
export const P1_ALT = 0.55;

export function approachPoint(
  eye: Vec3,
  yaw: number,
  b: Bounds,
  out: Vec3,
  back = APPROACH_BACK_M,
  up = APPROACH_UP_M,
) {
  // behind = opposite to the horizontal view direction (sin yaw, cos yaw) * -1 in x/z
  const bx = Math.sin(yaw);
  const bz = Math.cos(yaw);
  let x = eye[0] + bx * back;
  let z = eye[2] + bz * back;
  const cx = Math.min(b.half - WALL_INSET_M, Math.max(-(b.half - WALL_INSET_M), x));
  const cz = Math.min(b.depth - WALL_INSET_M, Math.max(WALL_INSET_M, z));
  const lost = Math.hypot(x - cx, z - cz);
  x = cx;
  z = cz;
  out[0] = x;
  // closer to the eye than planned: steeper, so it still clears the row behind
  out[1] = eye[1] + up + lost * 0.6;
  out[2] = z;
  return out;
}

export const bez = (a: number, b: number, c: number, d: number, t: number) => {
  const m = 1 - t;
  return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d;
};

const sP1: Vec3 = [0, 0, 0];
const sP2: Vec3 = [0, 0, 0];

/**
 * One continuous move from the top-down pose over the map (p = 0) to the seat (p = 1), `p`
 * being the eased progress (`easeFlight`). Position is a cubic Bezier: it stays high and heads
 * for the point above the seat, then settles forward and down into the seat along the view
 * direction from behind and above the row behind (never sideways at seat height). The camera
 * turns evenly from looking down to looking at the screen (heading and elevation, so it never
 * rolls); the lens change is done by 60 % of the move. The reverse is the same curve with p
 * running down.
 */
export function divePose(
  p: number,
  top: TopDownPose,
  eye: Vec3,
  center: Vec3,
  povFovDeg: number,
  out: DivePose,
  bounds: Bounds,
  /** 0 opening (the approved aim); 1 leaving: the look stays on the held seat (seats stay in frame). */
  held = 0,
): DivePose {
  const k = Math.min(1, Math.max(0, p));
  const end = viewAngles(eye, center);
  const p1 = sP1;
  p1[0] = eye[0];
  p1[1] = Math.max(eye[1] + APPROACH_UP_M, top.position[1] * P1_ALT);
  p1[2] = eye[2];
  const p2 = approachPoint(eye, end.yaw, bounds, sP2);
  out.position[0] = bez(top.position[0], p1[0], p2[0], eye[0], k);
  out.position[1] = bez(top.position[1], p1[1], p2[1], eye[1], k);
  out.position[2] = bez(top.position[2], p1[2], p2[2], eye[2], k);
  aimAt(k, top, out, center, end.yaw, eye, held);
  // The lens and the stretch of the seats move evenly with the curve: no burst of zoom.
  out.fov = tanLerpDeg(top.fov, povFovDeg, k);
  out.squash = top.squash + (1 - top.squash) * k;
  return out;
}

/**
 * Vertical field of view for the view from a seat: wide enough to show the whole screen plus a
 * margin (looking at its centre), but never fisheye (cap) or telephoto (floor). Seats close to
 * the screen cannot see all of it within the cap and keep the true direction anyway.
 */
export function povFov(
  eye: Vec3,
  hall: HallDims,
  aspect: number,
  opts: { min?: number; max?: number; margin?: number } = {},
): number {
  const { min = 50, max = 100, margin = 1.1 } = opts;
  const c = screenCenter(hall);
  const fx = c[0] - eye[0];
  const fy = c[1] - eye[1];
  const fz = c[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const f: Vec3 = [fx / fl, fy / fl, fz / fl];
  // right = f x up(0,1,0), then up' = right x f
  let r: Vec3 = [-f[2], 0, f[0]];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  r = [r[0] / rl, 0, r[2] / rl];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  let tanH = 0;
  let tanV = 0;
  for (const dx of [-0.5, 0.5]) {
    for (const y of [SCREEN_BOTTOM_M, SCREEN_BOTTOM_M + hall.screen_height_m]) {
      const q: Vec3 = [hall.screen_x_m + dx * hall.screen_width_m - eye[0], y - eye[1], -eye[2]];
      const z = q[0] * f[0] + q[1] * f[1] + q[2] * f[2];
      if (z <= 0.05) return max;
      tanH = Math.max(tanH, Math.abs(q[0] * r[0] + q[1] * r[1] + q[2] * r[2]) / z);
      tanV = Math.max(tanV, Math.abs(q[0] * u[0] + q[1] * u[1] + q[2] * u[2]) / z);
    }
  }
  const need = Math.max(tanV, tanH / Math.max(aspect, 0.1)) * margin;
  const deg = (2 * Math.atan(need) * 180) / Math.PI;
  return Math.min(max, Math.max(min, deg));
}

/** A camera as plain numbers (readable from the UI thread): position, heading, elevation, lens, canvas size. */
export type CamState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fov: number;
  squash: number;
  shift: number;
  w: number;
  h: number;
};

export function newCamState(): CamState {
  return {
    x: 0,
    y: 100,
    z: 0,
    yaw: 0,
    pitch: -Math.PI / 2,
    fov: 14,
    squash: 1,
    shift: 0,
    w: 1,
    h: 1,
  };
}

/** The camera of a pose in a canvas of `w` x `h` px. */
export function camOf(p: DivePose, shift: number, w: number, h: number): CamState {
  return {
    x: p.position[0],
    y: p.position[1],
    z: p.position[2],
    yaw: p.yaw,
    pitch: p.pitch,
    fov: p.fov,
    squash: p.squash,
    shift,
    w,
    h,
  };
}

/**
 * Where a hall point (x, y up, z away from the screen) lands in canvas pixels, the way the 3D
 * camera draws it. Returns false in `out[2]` when the point is behind the camera.
 */
export function projectToPx(c: CamState, px: number, py: number, pz: number, out: Vec3): Vec3 {
  'worklet';
  const cp = Math.cos(c.pitch);
  const sp = Math.sin(c.pitch);
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  const qx = px - c.x;
  const qy = py - c.y;
  const qz = pz - c.z;
  const d = qx * (-sy * cp) + qy * sp + qz * (-cy * cp);
  const t = Math.tan((c.fov * Math.PI) / 360);
  const nx = (qx * cy + qz * -sy) / d / (t * (c.w / c.h));
  const ny = ((qx * (sy * sp) + qy * cp + qz * (cy * sp)) / d / t) * c.squash + c.shift;
  out[0] = ((nx + 1) / 2) * c.w;
  out[1] = ((1 - ny) / 2) * c.h;
  out[2] = d > 0.05 ? 1 : 0;
  return out;
}

const sA: Vec3 = [0, 0, 0];
const sB: Vec3 = [0, 0, 0];

/** The camera of the aligned top-down frame (the end of every close). */
export function topCam(top: TopDownPose, w: number, h: number): CamState {
  return {
    x: top.position[0],
    y: top.position[1],
    z: top.position[2],
    yaw: 0,
    pitch: -Math.PI / 2,
    fov: top.fov,
    squash: top.squash,
    shift: 0,
    w,
    h,
  };
}

/**
 * How far, in px, the grid as drawn by `now` is from the aligned top-down frame: the largest
 * distance between the two projections of a few points on the seats (near the look point and
 * 8 m either way across and along it).
 */
export function gridAlignmentPx(now: CamState, top: TopDownPose, planeY: number): number {
  const goal = topCam(top, now.w, now.h);
  let worst = 0;
  for (const [dx, dz] of [
    [0, 0],
    [8, 0],
    [0, 8],
    [-8, -8],
  ] as const) {
    const x = top.target[0] + dx;
    const z = top.target[2] + dz;
    projectToPx(now, x, planeY, z, sA);
    projectToPx(goal, x, planeY, z, sB);
    if (!sA[2]) return Number.POSITIVE_INFINITY;
    worst = Math.max(worst, Math.hypot(sA[0] - sB[0], sA[1] - sB[1]));
  }
  return worst;
}
