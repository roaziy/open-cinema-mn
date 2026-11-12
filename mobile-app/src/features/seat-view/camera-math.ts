import { EYE_HEIGHT_M, SCREEN_BOTTOM_M } from '@/shared';

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

/** Horizontal angle the view from a seat takes in. */
export const POV_ACROSS_DEG = 46;

/**
 * The lens for the view from a seat: the same for every seat, about 46 degrees across (a
 * natural eye; from the middle rows the screen fills it), vertical capped at 85 so a tall phone
 * never goes fisheye and floored at 50 on wide canvases.
 */
export function fovForAspect(aspect: number): number {
  const a = Math.max(aspect, 0.1);
  const v = (2 * Math.atan(Math.tan((POV_ACROSS_DEG * Math.PI) / 360) / a) * 180) / Math.PI;
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

/** Where the screen's centre sits in the view from a seat: about 31 % down from the top. */
const POV_LIFT_NDC = 0.38;
/** The view from a seat is held near level: at most this far down (back rows)... */
const POV_PITCH_MIN = (-18 * Math.PI) / 180;
/** ...and at most this far up (front rows, which would otherwise crane up at the screen). */
const POV_PITCH_MAX = (3 * Math.PI) / 180;

/**
 * Heading and elevation of the view from a seat: turned toward the screen's centre, but held
 * near level, so verticals stay vertical (no keystone), the screen sits in the top third and the
 * rows in front fill the rest. From the front rows the top of the screen may be cut off.
 */
export function povLook(eye: Vec3, center: Vec3, fovDeg: number): { yaw: number; pitch: number } {
  const v = viewAngles(eye, center);
  const lift = Math.atan(POV_LIFT_NDC * Math.tan((fovDeg * Math.PI) / 360));
  return { yaw: v.yaw, pitch: Math.min(POV_PITCH_MAX, Math.max(POV_PITCH_MIN, v.pitch - lift)) };
}

/**
 * A smooth curve through keys (`xs` ascending), flat before the first and after the last, that
 * never overshoots between them (monotone cubic with Fritsch-Butland tangents): one channel of
 * the camera, keyed like an animation timeline. A key between two rising (or two falling) keys
 * is passed through without stopping.
 */
export function keyed(x: number, xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const xAt = (i: number) => xs[i] as number;
  const yAt = (i: number) => ys[i] as number;
  if (x <= xAt(0)) return yAt(0);
  if (x >= xAt(n - 1)) return yAt(n - 1);
  let i = 0;
  while (x > xAt(i + 1)) i++;
  const tangent = (j: number) => {
    if (j === 0 || j === n - 1) return 0;
    const h0 = xAt(j) - xAt(j - 1);
    const h1 = xAt(j + 1) - xAt(j);
    const d0 = (yAt(j) - yAt(j - 1)) / h0;
    const d1 = (yAt(j + 1) - yAt(j)) / h1;
    if (d0 * d1 <= 0) return 0;
    const w0 = 2 * h1 + h0;
    const w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / d0 + w1 / d1);
  };
  const h = xAt(i + 1) - xAt(i);
  const t = (x - xAt(i)) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * yAt(i) +
    (t3 - 2 * t2 + t) * tangent(i) * h +
    (-2 * t3 + 3 * t2) * yAt(i + 1) +
    (t3 - t2) * tangent(i + 1) * h
  );
}

/** A point behind and above an eye along a heading, inside the room (the seat-to-seat glide's control points). */
export const APPROACH_BACK_M = 2;
export const APPROACH_UP_M = 1.2;
const WALL_INSET_M = 0.4;

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

/**
 * The view from a seat is taken from just behind and above its eye, over the seat's own back
 * (as the reference does): the camera never has to sink into a seat, and the arc in ends there.
 */
export const VIEW_BACK_M = 0.5;
export const VIEW_UP_M = 0.35;

/** How far behind (x, z) along heading `yaw` the walls leave room for. */
function roomBehind(x: number, z: number, yaw: number, bounds: Bounds): number {
  const bx = Math.sin(yaw);
  const bz = Math.cos(yaw);
  return Math.max(
    0,
    Math.min(
      bz > 1e-3 ? (bounds.depth - WALL_INSET_M - z) / bz : Number.POSITIVE_INFINITY,
      Math.abs(bx) > 1e-3
        ? (bounds.half - WALL_INSET_M - Math.abs(x)) / Math.abs(bx)
        : Number.POSITIVE_INFINITY,
    ),
  );
}

/** Where the camera stands for a seat: behind its eye, away from the screen's centre (short of the walls), and up. */
export function seatView(eye: Vec3, center: Vec3, bounds: Bounds, out: Vec3): Vec3 {
  const yaw = viewAngles(eye, center).yaw;
  const back = Math.min(VIEW_BACK_M, roomBehind(eye[0], eye[2], yaw, bounds));
  out[0] = eye[0] + Math.sin(yaw) * back;
  out[1] = eye[1] + VIEW_UP_M;
  out[2] = eye[2] + Math.cos(yaw) * back;
  return out;
}

// The open, on the fraction of its time (the close plays it backwards): one arc around the
// seat top, every part of it on the same ease so the camera never pauses between moves.
/** The heading turns toward the screen while the camera swings (never while looking straight down). */
const T_TURN_FROM = 0.28;
const T_TURN = 0.9;
/** The map's sideways offset from the seat is gone by here. */
const T_CENTRED = 0.45;
/** How close to a wall the arc starts to be held off it. */
const WALL_SOFT_M = 0.6;
/** The eye over the seat top. */
const EYE_OVER_SEAT_M = EYE_HEIGHT_M - SEAT_TOP_M;
const DOWN = -Math.PI / 2;
/** Where the squash stops following the foreshortening exactly and eases into 1. */
const SQUASH_KNEE = 0.85;

const lnTan = (deg: number) => Math.log(Math.tan((deg * Math.PI) / 360));
const degOfLnTan = (l: number) => (2 * Math.atan(Math.exp(l)) * 180) / Math.PI;
const sView: Vec3 = [0, 0, 0];

/**
 * The move from the top-down pose over the map (p = 0) to the seat's view (p = 1), `p` being
 * the fraction of the move's time (the clock is linear: the ease is in the pose). One arc
 * around the seat top, starting where the map's camera is: it closes in on the seat while
 * swinging down behind it and tilting up from looking down to looking at the screen, and eases
 * into the view over the seat's back, all on one ease, so the camera never pauses between
 * moves (the lens opens no faster than the camera closes in: the picture only grows). The
 * elevation is whatever keeps the seat sliding steadily down the picture from its place on the
 * map to its place in the final view (it never drops out and comes back). Heading and
 * elevation only (never a roll); the heading turns to the screen only during the swing. The
 * projection's vertical squash (rows are packed tighter on the map) is undone as the tilt
 * foreshortens the rows, so the hall never visibly stretches. The close is the same curve with
 * p running down.
 */
export function divePose(
  p: number,
  top: TopDownPose,
  eye: Vec3,
  center: Vec3,
  povFovDeg: number,
  out: DivePose,
  bounds: Bounds,
): DivePose {
  const k = Math.min(1, Math.max(0, p));
  const view = seatView(eye, center, bounds, sView);
  const end = povLook(view, center, povFovDeg);
  // The pivot (the seat top under the eye) and where the view and the map's camera sit around it.
  const sx = eye[0];
  const sy = eye[1] - EYE_OVER_SEAT_M;
  const sz = eye[2];
  const viewBack = Math.hypot(view[0] - sx, view[2] - sz);
  const viewUp = view[1] - sy;
  const rEnd = Math.hypot(viewBack, viewUp);
  const swingEnd = Math.atan2(viewUp, viewBack);
  const h0 = Math.max(top.position[1] - sy, 1e-3);
  // The map's camera looks straight down with the screen at the top: behind the seat is +z.
  const back0 = top.position[2] - sz;
  const side0 = top.position[0] - sx;
  const r0 = Math.hypot(h0, back0);
  const swing0 = Math.atan2(h0, back0);
  const t0 = lnTan(top.fov);
  const t1 = lnTan(povFovDeg);
  // One ease for the closing in (in proportion, so it reads as an even zoom), the swing and the
  // seat's slide. Giving them their own timings (zooming first, tilting after, then settling,
  // as the reference does) leaves lulls between them that read as separate moves.
  const ease = keyed(k, [0, 1], [0, 1]);
  const r = Math.exp(Math.log(r0) + (Math.log(rEnd) - Math.log(r0)) * ease);
  // The lens opens from the map's near-orthographic one to the seat's, ahead of the closing in
  // but never faster than 90 % of it (in proportion): the picture only ever zooms in. (Opening
  // it on its own ease made the picture shrink first and then grow: a hidden second move.)
  const pace = Math.max(1, (0.9 * Math.log(r0 / rEnd)) / Math.max(1e-6, t1 - t0));
  const lens = t0 + (t1 - t0) * (1 - (1 - ease) ** pace);
  const tanHalf = Math.exp(lens);
  const swing = swing0 + (swingEnd - swing0) * ease;
  out.yaw = keyed(k, [T_TURN_FROM, T_TURN], [0, end.yaw]);
  // Behind the seat along the heading, never through the back or side walls: exact up to where
  // the view stands, easing into the room that is left beyond it.
  const room = roomBehind(sx, sz, out.yaw, bounds);
  // The limit only acts within WALL_SOFT_M of a wall, so for nearly every seat it does nothing;
  // where the map's camera itself starts there, the exact start fades into it over time.
  const orbit = r * Math.cos(swing);
  const above = r * Math.sin(swing);
  const free = Math.max(viewBack, room - WALL_SOFT_M);
  const slack = Math.max(1e-3, room - free);
  const walled = orbit <= free ? orbit : free + slack * Math.tanh((orbit - free) / slack);
  const behind = walled + (orbit - walled) * (1 - ease) ** 3;
  // The map's sideways offset shrinks with the picture's scale (the seat keeps its place across
  // the picture while zooming) and is gone while the camera is still high: never a sideways
  // sweep low over the rows, however far the map was panned.
  const side = side0 * keyed(k, [0, T_CENTRED], [1, 0]) * ((r * tanHalf) / (r0 * Math.exp(t0)));
  const cy = Math.cos(out.yaw);
  const sy_ = Math.sin(out.yaw);
  out.position[0] = sx + side * cy + sy_ * behind;
  out.position[1] = sy + above;
  out.position[2] = sz - side * sy_ + cy * behind;
  out.fov = degOfLnTan(lens);
  // The seat is seen `dip` below the horizontal: aim so it sits at `seatNdc` (unsquashed), sliding
  // steadily from its place on the map to its place in the final view (front rows, which end
  // looking level, slide it out of the bottom on the way).
  const dip = Math.atan2(above, behind);
  const seatMap = Math.tan(Math.PI / 2 - swing0) / Math.exp(t0);
  const seatEnd = Math.tan(-swingEnd - end.pitch) / Math.exp(t1);
  const seatNdc = seatMap + (seatEnd - seatMap) * ease;
  out.pitch = -dip - Math.atan(seatNdc * tanHalf);
  const s0 = top.squash;
  if (s0 < 1) {
    // eased into 1 (no dead stop): exact below the knee, exponentially close above it
    const q = s0 / Math.max(1e-3, -Math.sin(out.pitch));
    const knee = Math.max(SQUASH_KNEE, s0);
    out.squash = q <= knee ? q : 1 - (1 - knee) * Math.exp(-(q - knee) / (1 - knee));
  } else {
    const tilt = (out.pitch - DOWN) / Math.max(1e-6, end.pitch - DOWN);
    out.squash = s0 + (1 - s0) * Math.min(1, Math.max(0, tilt));
  }
  return out;
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
