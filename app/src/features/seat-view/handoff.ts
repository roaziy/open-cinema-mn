import { smoothstep } from './camera-math';

/** The 3D to 2D hand-off covers the last stretch of the close: from this dive progress down to 0. */
export const HANDOFF_FROM = 0.3;
/** The grid crossfade lasts this long... */
export const CROSSFADE_MS = 450;
/** ...and starts this long before the camera lands, so it is over 200 ms after. */
export const LEAD_MS = 250;

/** 2D tile width over the 3D seat's width (0.55 m pitch * 0.86 over cushion + armrests 0.52 m). */
export const TILE_WIDTH_RATIO = (0.55 * 0.86) / 0.52;

/** The closing flag when the view is not being left; otherwise the dive progress at which leaving began. */
export const NOT_CLOSING = -1;

/**
 * Share of the hand-off that has happened: 0 until the close reaches `HANDOFF_FROM`, 1 at the
 * map. A close that begins below `HANDOFF_FROM` (the open dive was still near the map) starts
 * from 0 and ramps to 1, so the look never jumps.
 */
export function handoffProgress(dive: number, closeStart: number): number {
  'worklet';
  if (closeStart < 0) return 0;
  const raw = Math.min(1, Math.max(0, (HANDOFF_FROM - dive) / HANDOFF_FROM));
  const p0 = Math.min(1, Math.max(0, (HANDOFF_FROM - closeStart) / HANDOFF_FROM));
  return p0 >= 1 ? 1 : Math.min(1, Math.max(0, (raw - p0) / (1 - p0)));
}

/**
 * What the close looks like at a given dive progress. `landmarks` is the opacity of the 2D
 * layers with no 3D counterpart (screen arc and label, row letters, seat icons): they arrive
 * first. `morph` takes the 3D seats to the 2D tiles: lighting off, footprint, held seats at tile
 * size, the 3D screen band gone. A pure function of progress, so it is reversible.
 */
export function handoffLook(dive: number, closeStart: number) {
  'worklet';
  const p = handoffProgress(dive, closeStart);
  const landmarks = smoothstep(0.05, 0.7, p);
  const morph = smoothstep(0.2, 1, p);
  return {
    landmarks,
    morph,
    /** Multiplies the scene's lighting (it fades out). */
    light: 1 - morph,
    /** Seat width: 3D armrests and all, down to the 2D tile's width (0.47 m of 0.52). */
    footprintX: 1 - morph * (1 - TILE_WIDTH_RATIO),
    /** The 3D screen band's opacity. */
    screen: 1 - landmarks,
  };
}

/** Held seats' accent shell: from the oversized box to exactly the tile (scale 1) as `morph` goes to 1. */
export function heldScale(morph: number, current: boolean): number {
  'worklet';
  const big = current ? 1.3 : 1.06;
  return big + (1 - big) * morph;
}
