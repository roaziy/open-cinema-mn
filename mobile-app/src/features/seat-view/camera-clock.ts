/**
 * Timing of the dive. `divePose` is keyed on the fraction of the move's time (its eases are in
 * the keys), so it is played linearly: progress = elapsed / duration.
 */

/** How long the open takes: zoom, tilt and settle in a little over a second. */
export const OPEN_MS = 1150;
/** The close is the open backwards, a little quicker. */
export const CLOSE_MS = 1100;
/** Turning a dive round in flight: how long its pace takes to swing over to the new move's. */
export const TURN_BLEND_MS = 350;

/** Progress per ms of the open (+) or the close (-). */
export function divePace(closing: boolean): number {
  return closing ? -1 / CLOSE_MS : 1 / OPEN_MS;
}

/**
 * How long the pace swing of a turn-round takes: TURN_BLEND_MS, shorter near the end the
 * camera was heading for, so carrying on before coming back never runs past it.
 */
export function turnBlendMs(s0: number, v0: number): number {
  const room = v0 > 0 ? 1 - s0 : s0;
  return Math.min(TURN_BLEND_MS, Math.max(60, (2.5 * room) / Math.max(Math.abs(v0), 1e-9)));
}

/**
 * Progress `t` ms after a dive was turned round at `s0` while moving at `v0` (progress per ms):
 * the pace swings smoothly from `v0` to `pace` over `b` ms and then holds, so the rest plays
 * exactly like the normal move and neither the camera nor its speed jumps.
 */
export function turnRoundAt(t: number, s0: number, v0: number, pace: number, b: number): number {
  if (t >= b) return s0 + ((v0 + pace) / 2) * b + pace * (t - b);
  const u = Math.max(0, t) / b;
  // the pace is v0 + (pace - v0) * smoothstep(u); this is its integral
  return s0 + v0 * t + (pace - v0) * b * (u * u * u - (u * u * u * u) / 2);
}

/** How long a dive turned round at `s0` (moving at `v0`, swinging over `b` ms) takes to reach `to` at `pace`. */
export function turnRoundMs(s0: number, to: number, v0: number, pace: number, b: number): number {
  const atBlend = s0 + ((v0 + pace) / 2) * b;
  return b + Math.max(0, (to - atBlend) / pace);
}

/** How close (px) the drawn grid must be to the 2D layout before the crossfade may start. */
export const ALIGN_PX = 2;

/** True when a closing flight's grid is within `ALIGN_PX` of the 2D layout and the lead-out has not been sent. */
export function shouldLead(alignPx: number, closing: boolean, sent: boolean): boolean {
  return closing && !sent && alignPx <= ALIGN_PX;
}
