import { smoothstep } from './camera-math';

/** The page header, legend and footer stay fully visible over the 3D picture until this much of the dive... */
export const CHROME_FULL_UNTIL = 0.35;
/** ...and are gone by this much of it. Closing plays the same range backwards. */
export const CHROME_GONE_AT = 0.6;
/** How far the footer slides down while it fades, points. */
export const FOOTER_SLIDE = 24;

/**
 * How much of the page chrome shows. `dive` is the move's progress (0 over the map, 1 at the
 * seat); `fade` is the 0..1 crossfade of the 3D picture. With Reduce Motion there is no dive,
 * so the chrome follows the crossfade instead.
 */
export function chromeOpacity(dive: number, fade: number, reduceMotion: boolean): number {
  'worklet';
  if (reduceMotion) return 1 - fade;
  return 1 - smoothstep(CHROME_FULL_UNTIL, CHROME_GONE_AT, dive);
}

/** The footer's downward slide while it fades (0 when fully shown). */
export function footerSlide(dive: number, fade: number, reduceMotion: boolean): number {
  'worklet';
  return (1 - chromeOpacity(dive, fade, reduceMotion)) * FOOTER_SLIDE;
}
