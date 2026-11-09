import { POV_ACROSS_DEG, smoothstep } from './camera-math';

/**
 * Where the view from a seat is turned to, on top of the seat's own heading and elevation, the
 * camera staying where it is (as in Street View): by a finger drag, which can be flung, and
 * (when switched on) by turning the phone. Radians; positive yaw turns left, positive pitch
 * looks up (the camera's conventions). The camera shows `shown*`, which eases after the
 * targets every frame, so uneven touch events never reach the picture as jerks.
 */
export type Look = {
  /** Drag target. */
  yaw: number;
  pitch: number;
  /** Phone target (its turn since look-around was switched on). */
  gyroYaw: number;
  gyroPitch: number;
  /** Fling, radians per second, while no finger is down. */
  vYaw: number;
  vPitch: number;
  /** A finger is down on the picture. */
  held: boolean;
  /** What the camera shows. */
  shownYaw: number;
  shownPitch: number;
  listeners: Set<() => void>;
};

const RAD = Math.PI / 180;
/** How far the view may be tilted up from the seat's own view... */
export const LOOK_UP_MAX = 40 * RAD;
/** ...and down. (Turning round is free, all the way.) */
export const LOOK_DOWN_MAX = 55 * RAD;
/** The picture catches up with the targets with this time constant. */
export const LOOK_EASE_MS = 45;
/** A fling slows with this time constant... */
export const FLING_TAU_MS = 325;
/** ...is never faster than this (radians per second)... */
export const FLING_MAX = 4;
/** ...and stops below this. */
const FLING_STOP = 0.02;
/** Longest frame step taken (a frame after a long idle must not jump). */
const STEP_MAX_MS = 50;

export function newLook(): Look {
  return {
    yaw: 0,
    pitch: 0,
    gyroYaw: 0,
    gyroPitch: 0,
    vYaw: 0,
    vPitch: 0,
    held: false,
    shownYaw: 0,
    shownPitch: 0,
    listeners: new Set(),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The turn the camera shows, on top of the seat's view. */
export function lookYaw(l: Look): number {
  return l.shownYaw;
}
export function lookPitch(l: Look): number {
  return l.shownPitch;
}

function changed(l: Look) {
  for (const fn of l.listeners) fn();
}

export function subscribeLook(l: Look, fn: () => void): () => void {
  l.listeners.add(fn);
  return () => {
    l.listeners.delete(fn);
  };
}

/** Radians per px of drag on a picture `width` px wide: a full-width drag turns it by the lens's width. */
const perPx = (width: number) => (POV_ACROSS_DEG * RAD) / Math.max(1, width);

/** The drag's pitch kept so that drag and phone together stay inside the limits. */
const pitchRoom = (l: Look, p: number) =>
  clamp(p, -LOOK_DOWN_MAX - l.gyroPitch, LOOK_UP_MAX - l.gyroPitch);

/** A finger came down: it catches a fling. */
export function grabLook(l: Look): void {
  l.held = true;
  l.vYaw = 0;
  l.vPitch = 0;
  changed(l);
}

/** The finger moved (dx, dy) px: the scene follows it (drag right to look left, down to look up). */
export function dragLook(l: Look, dx: number, dy: number, width: number): void {
  const k = perPx(width);
  l.yaw += dx * k;
  l.pitch = pitchRoom(l, l.pitch + dy * k);
  changed(l);
}

/** The finger lifted moving at (vx, vy) px/s: the view glides on and slows to a stop. */
export function releaseLook(l: Look, vx: number, vy: number, width: number): void {
  const k = perPx(width);
  l.held = false;
  l.vYaw = clamp(vx * k, -FLING_MAX, FLING_MAX);
  l.vPitch = clamp(vy * k, -FLING_MAX, FLING_MAX);
  changed(l);
}

/** The touch ended without a drag (a tap, a cancel): nothing glides. */
export function letGoLook(l: Look): void {
  if (!l.held) return;
  l.held = false;
  changed(l);
}

/** The phone's turn since look-around was switched on. */
export function setGyroLook(l: Look, yaw: number, pitch: number): void {
  l.gyroYaw = yaw;
  l.gyroPitch = pitch;
  changed(l);
}

/** Switching the phone off keeps the view where it is: its turn becomes part of the drag. */
export function foldGyroLook(l: Look): void {
  l.yaw += l.gyroYaw;
  l.pitch = clamp(l.pitch + l.gyroPitch, -LOOK_DOWN_MAX, LOOK_UP_MAX);
  l.gyroYaw = 0;
  l.gyroPitch = 0;
  changed(l);
}

/**
 * One frame, `dtMs` long: a fling moves the targets on and slows; the shown turn eases after
 * the targets. Returns whether anything is still moving (the picture must keep being drawn).
 */
export function stepLook(l: Look, dtMs: number): boolean {
  const dt = Math.min(STEP_MAX_MS, Math.max(0, dtMs));
  if (!l.held && (l.vYaw !== 0 || l.vPitch !== 0)) {
    l.yaw += (l.vYaw * dt) / 1000;
    const pitch = pitchRoom(l, l.pitch + (l.vPitch * dt) / 1000);
    if (pitch !== l.pitch + (l.vPitch * dt) / 1000) l.vPitch = 0; // ran into a limit
    l.pitch = pitch;
    const decay = Math.exp(-dt / FLING_TAU_MS);
    l.vYaw *= decay;
    l.vPitch *= decay;
    if (Math.hypot(l.vYaw, l.vPitch) < FLING_STOP) {
      l.vYaw = 0;
      l.vPitch = 0;
    }
  }
  const yaw = l.yaw + l.gyroYaw;
  const pitch = clamp(l.pitch + l.gyroPitch, -LOOK_DOWN_MAX, LOOK_UP_MAX);
  const a = 1 - Math.exp(-dt / LOOK_EASE_MS);
  l.shownYaw += (yaw - l.shownYaw) * a;
  l.shownPitch += (pitch - l.shownPitch) * a;
  const settled = Math.abs(yaw - l.shownYaw) < 1e-4 && Math.abs(pitch - l.shownPitch) < 1e-4;
  if (settled) {
    l.shownYaw = yaw;
    l.shownPitch = pitch;
  }
  return l.held || l.vYaw !== 0 || l.vPitch !== 0 || !settled;
}

/**
 * How much of the turn applies at dive progress `k`: all of it at the seat, none over the map.
 * A close fades it out over its first stretch, so the way back to the map is exactly the dive's.
 */
export function lookWeight(k: number): number {
  return smoothstep(0.75, 1, k);
}

/**
 * Heading and elevation (radians) of the direction the phone's back camera faces, from the
 * device attitude quaternion (device to reference frame, reference z up). Heading grows turning
 * left (counter-clockwise seen from above), elevation looking up.
 */
export function phoneAim(
  qx: number,
  qy: number,
  qz: number,
  qw: number,
): { heading: number; elevation: number } {
  // v' = q v q*, for v = (0, 0, -1): the back of the phone in device coordinates
  const x = -2 * (qx * qz + qw * qy);
  const y = -2 * (qy * qz - qw * qx);
  const z = -(1 - 2 * (qx * qx + qy * qy));
  return {
    heading: Math.atan2(y, x),
    elevation: Math.asin(clamp(z, -1, 1)),
  };
}

/** The signed smallest difference a - b between two angles. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
