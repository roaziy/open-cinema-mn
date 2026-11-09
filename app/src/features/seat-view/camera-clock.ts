import {
  type Bounds,
  type DivePose,
  divePose,
  EASE_PEAK,
  MAX_TURN_DEG_PER_S,
  newDivePose,
  rotationAngleDeg,
  smoothstep,
  type TopDownPose,
  type Vec3,
} from './camera-math';

const sTurnPose = newDivePose();

const CLOCK_STEPS = 200;
/** Fastest the lens may change: ln of tan(fov/2) per second. */
export const MAX_ZOOM_LN_PER_S = 3;

/**
 * Time to progress along a move. The curve is the same however fast it is played; the clock
 * decides when each part of it happens: every small step of the curve gets the time its turn and
 * its lens change need under the caps (90 degrees and 3 ln a second), so the work is spread
 * instead of bursting where the camera turns or zooms most, and `ms` is the total for the whole
 * move at the ease's peak speed. `at(tau)` takes the linear fraction of the time (0..1), eases it
 * and returns the progress k (0..1) along the curve.
 */
export type MoveClock = {
  ms: number;
  at: (tau: number) => number;
  /** The inverse: the linear time fraction at which the progress is `k`. */
  tauOf: (k: number) => number;
};

/** The caps a clock plays a move under. */
export type ClockCaps = {
  turnDegPerS: number;
  zoomLnPerS: number;
  minMs: number;
  maxMs: number;
};

/** Opening: 90 degrees and 3 ln a second, 1.6 to 3.2 s. */
export const OPEN_CAPS: ClockCaps = {
  turnDegPerS: MAX_TURN_DEG_PER_S,
  zoomLnPerS: MAX_ZOOM_LN_PER_S,
  minMs: 1600,
  maxMs: 3200,
};
/** Closing is about 30 percent quicker: 125 degrees and 4 ln a second. */
export const CLOSE_CAPS: ClockCaps = {
  turnDegPerS: 125,
  zoomLnPerS: 4,
  minMs: 1100,
  maxMs: 2300,
};

function buildClock(pose: (k: number, out: DivePose) => DivePose, caps: ClockCaps): MoveClock {
  const n = CLOCK_STEPS;
  const cum = new Float64Array(n + 1);
  const needs = new Float64Array(n + 1);
  let prev = pose(0, sTurnPose);
  let py = prev.yaw;
  let pp = prev.pitch;
  let pf = Math.tan((prev.fov * Math.PI) / 360);
  for (let i = 1; i <= n; i++) {
    prev = pose(i / n, sTurnPose);
    const turn = rotationAngleDeg(py, pp, prev.yaw, prev.pitch);
    const tf = Math.tan((prev.fov * Math.PI) / 360);
    const lens = Math.abs(Math.log(tf / pf));
    // seconds this step needs at the caps, with a little for the camera simply travelling
    needs[i] = Math.max(turn / caps.turnDegPerS, lens / caps.zoomLnPerS, 0.3 / n);
    py = prev.yaw;
    pp = prev.pitch;
    pf = tf;
  }
  for (let i = 1; i <= n; i++) cum[i] = (cum[i - 1] as number) + (needs[i] as number);
  const total = cum[n] as number;
  for (let i = 1; i <= n; i++) cum[i] = (cum[i] as number) / total;
  // the ease's steepest part runs EASE_PEAK times faster than a steady pace
  const ms = Math.min(caps.maxMs, Math.max(caps.minMs, total * EASE_PEAK * 1000 * 1.02));
  const at = (tau: number) => {
    const u = smoothstep(0, 1, tau);
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((cum[mid] as number) <= u) lo = mid;
      else hi = mid;
    }
    const span = (cum[hi] as number) - (cum[lo] as number);
    const f = span > 1e-12 ? (u - (cum[lo] as number)) / span : 0;
    return (lo + Math.min(1, Math.max(0, f))) / n;
  };
  const tauOf = (k: number) => {
    const target = Math.min(1, Math.max(0, k));
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return { ms, at, tauOf };
}

/** The clock for the dive to this seat (1.6 to 3.2 s, the turn cap decides). */
export function diveClock(
  top: TopDownPose,
  eye: Vec3,
  center: Vec3,
  povFovDeg: number,
  bounds: Bounds,
  caps: ClockCaps = OPEN_CAPS,
  /** When leaving: z of the front edge of the seat block (the aim's floor waypoint). */
  front: number | null = null,
): MoveClock {
  return buildClock((k, out) => divePose(k, top, eye, center, povFovDeg, out, bounds, front), caps);
}

/**
 * Progress when a move is turned round or retimed in flight: a cubic Hermite from `from` to
 * `to` over the unit time `s`, starting with the velocity the camera has right now (`v0`, per
 * unit of `s`) and ending at the pace of an undisturbed move (`v1`). No jump in speed.
 */
export function tauHermite(s: number, from: number, to: number, v0: number, v1: number): number {
  const t = Math.min(1, Math.max(0, s));
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * from + (t3 - 2 * t2 + t) * v0 + (-2 * t3 + 3 * t2) * to + (t3 - t2) * v1
  );
}

/**
 * How long to take turning a move round in flight so that the camera's fastest full rotation
 * stays under the cap: the move first carries on at the speed it has (`vel`, time fraction per
 * ms), then comes back. Longer is tried until the cap holds.
 */
export function reversalMs(
  pose: (k: number, out: DivePose) => DivePose,
  clock: MoveClock,
  from: number,
  to: number,
  vel: number,
  baseMs: number,
  capDegPerS = MAX_TURN_DEG_PER_S,
): number {
  const n = 90;
  const out = newDivePose();
  for (const m of [1, 1.3, 1.7, 2.2, 2.8, 3.5]) {
    const ms = baseMs * m;
    let prev = pose(clock.at(from), out);
    let py = prev.yaw;
    let pp = prev.pitch;
    let peak = 0;
    for (let i = 1; i <= n; i++) {
      prev = pose(clock.at(tauHermite(i / n, from, to, vel * ms, 0)), out);
      peak = Math.max(peak, (rotationAngleDeg(py, pp, prev.yaw, prev.pitch) * n) / (ms / 1000));
      py = prev.yaw;
      pp = prev.pitch;
    }
    if (peak <= capDegPerS) return ms;
  }
  return baseMs * 3.5;
}

/**
 * Turning a move round in flight: the camera is at `tau` of the move played on clock `prev` and
 * moving at `vel` (time fraction per ms); the new move runs on clock `next`. Returns where that
 * is on the new clock and the speed there, so the camera neither jumps nor changes speed.
 */
export function handOver(
  prev: MoveClock,
  next: MoveClock,
  tau: number,
  vel: number,
): { s0: number; vel: number } {
  const e = 1e-3;
  const k = prev.at(tau);
  const dkdTau = (prev.at(tau + e) - prev.at(tau - e)) / (2 * e);
  const dTaudk = (next.tauOf(k + e) - next.tauOf(k - e)) / (2 * e);
  return { s0: next.tauOf(k), vel: vel * dkdTau * dTaudk };
}

/** How close (px) the drawn grid must be to the 2D layout before the crossfade may start. */
export const ALIGN_PX = 2;

/** True when a closing flight's grid is within `ALIGN_PX` of the 2D layout and the lead-out has not been sent. */
export function shouldLead(alignPx: number, closing: boolean, sent: boolean): boolean {
  return closing && !sent && alignPx <= ALIGN_PX;
}
