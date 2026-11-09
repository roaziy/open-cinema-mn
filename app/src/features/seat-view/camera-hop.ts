import {
  approachPoint,
  type Bounds,
  bez,
  type DivePose,
  easeFlight,
  povLook,
  tanLerpDeg,
  type Vec3,
} from './camera-math';

const sQ1: Vec3 = [0, 0, 0];
const sQ2: Vec3 = [0, 0, 0];

/** How far above the higher of the two eyes the glide passes, metres. */
const HOP_RISE_M = 0.7;

/** Time for a seat switch: 1.6 s plus a little for distance, at most 2.2 s. */
export function hopDurationMs(a: Vec3, b: Vec3): number {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return Math.min(2200, 1600 + d * 50);
}

/** The seat switch at linear time fraction `t`: one ease-in-out over the glide, looking at the screen. */
export function hopFrame(
  t: number,
  a: Vec3,
  b: Vec3,
  center: Vec3,
  povA: number,
  povB: number,
  bounds: Bounds,
  out: DivePose,
): DivePose {
  return hopPose(easeFlight(t), a, b, center, povA, povB, bounds, out);
}

/**
 * Seat to seat without leaving 3D: one Bezier from eye A to eye B that rises just above the seat
 * backs, turning evenly from seat A's view to seat B's (heading and elevation, no roll).
 */
export function hopPose(
  p: number,
  a: Vec3,
  b: Vec3,
  center: Vec3,
  povFovA: number,
  povFovB: number,
  bounds: Bounds,
  out: DivePose,
): DivePose {
  const k = Math.min(1, Math.max(0, p));
  const va = povLook(a, center, povFovA);
  const vb = povLook(b, center, povFovB);
  // Rise only just above the seat backs on the way: the move reads as travelling between seats.
  const dy = Math.abs(a[1] - b[1]);
  const up = HOP_RISE_M + dy;
  const upB = HOP_RISE_M + dy;
  const q1 = approachPoint(a, va.yaw, bounds, sQ1, 0.5, up);
  const q2 = approachPoint(b, vb.yaw, bounds, sQ2, 0.5, upB);
  out.position[0] = bez(a[0], q1[0], q2[0], b[0], k);
  out.position[1] = bez(a[1], q1[1], q2[1], b[1], k);
  out.position[2] = bez(a[2], q1[2], q2[2], b[2], k);
  out.yaw = va.yaw + (vb.yaw - va.yaw) * k;
  out.pitch = va.pitch + (vb.pitch - va.pitch) * k;
  out.fov = tanLerpDeg(povFovA, povFovB, k);
  out.squash = 1;
  return out;
}
