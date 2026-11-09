import { POV_ACROSS_DEG, smoothstep } from './camera-math';

/**
 * Where the view from a seat is turned to, on top of the seat's own heading and elevation: by a
 * finger drag, and (when switched on) by turning the phone. Offsets in radians; positive yaw
 * turns left, positive pitch looks up (the camera's conventions).
 */
export type Look = {
  yaw: number;
  pitch: number;
  gyroYaw: number;
  gyroPitch: number;
  listeners: Set<() => void>;
};

const RAD = Math.PI / 180;
/** How far the view may be turned either way from the seat's own view... */
export const LOOK_YAW_MAX = 70 * RAD;
/** ...up... */
export const LOOK_UP_MAX = 30 * RAD;
/** ...and down. */
export const LOOK_DOWN_MAX = 45 * RAD;

export function newLook(): Look {
  return { yaw: 0, pitch: 0, gyroYaw: 0, gyroPitch: 0, listeners: new Set() };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The turn on top of the seat's view: drag plus phone, held inside the limits. */
export function lookYaw(l: Look): number {
  return clamp(l.yaw + l.gyroYaw, -LOOK_YAW_MAX, LOOK_YAW_MAX);
}
export function lookPitch(l: Look): number {
  return clamp(l.pitch + l.gyroPitch, -LOOK_DOWN_MAX, LOOK_UP_MAX);
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

/**
 * A finger drag of (dx, dy) px on a picture `width` px wide: the scene follows the finger (drag
 * right to look left), a full-width drag turning the view by the lens's width. The drag part is
 * kept inside the limits on its own, so dragging past an edge does not wind up.
 */
export function dragLook(l: Look, dx: number, dy: number, width: number): void {
  const perPx = (POV_ACROSS_DEG * RAD) / Math.max(1, width);
  l.yaw = clamp(l.yaw + dx * perPx, -LOOK_YAW_MAX - l.gyroYaw, LOOK_YAW_MAX - l.gyroYaw);
  l.pitch = clamp(l.pitch + dy * perPx, -LOOK_DOWN_MAX - l.gyroPitch, LOOK_UP_MAX - l.gyroPitch);
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
  l.yaw = clamp(l.yaw + l.gyroYaw, -LOOK_YAW_MAX, LOOK_YAW_MAX);
  l.pitch = clamp(l.pitch + l.gyroPitch, -LOOK_DOWN_MAX, LOOK_UP_MAX);
  l.gyroYaw = 0;
  l.gyroPitch = 0;
  changed(l);
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
