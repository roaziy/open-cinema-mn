/**
 * Decode-stability guards, kept pure so they can be tested hard. The camera hook feeds every
 * analysed frame through `advance`; a token comes out only when it is worth sending.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type Detected = { value: string; box: Rect };

/** The same value must be read on this many frames in a row (about 300 ms at 10 fps). */
export const STABLE_FRAMES = 3;
/** After a read, the same token is ignored for this long (counted from when the result closes). */
export const IGNORE_MS = 5000;

export type StableState = {
  candidate: string | null;
  count: number;
  last: string | null;
  ignoreUntil: number;
};

export const initialStable: StableState = { candidate: null, count: 0, last: null, ignoreUntil: 0 };

export function centerInside(box: Rect, roi: Rect): boolean {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return cx >= roi.x && cx <= roi.x + roi.width && cy >= roi.y && cy <= roi.y + roi.height;
}

export type Frame = {
  codes: Detected[];
  /** The scan frame in video pixels, or null while the layout is unknown. */
  roi: Rect | null;
  now: number;
  /** A request or a result card is up: nothing is read. */
  paused: boolean;
};

const reset = (s: StableState): StableState => ({ ...s, candidate: null, count: 0 });

export function advance(
  state: StableState,
  frame: Frame,
): { state: StableState; emit: string | null } {
  const { now } = frame;
  if (frame.paused) {
    // The ignore window starts when the pause ends, so a card that stays up for 30 s still
    // leaves the next 5 s protected.
    const ignoreUntil = state.last ? now + IGNORE_MS : state.ignoreUntil;
    return { state: { ...reset(state), ignoreUntil }, emit: null };
  }
  const { roi } = frame;
  const values = roi
    ? [...new Set(frame.codes.filter((c) => centerInside(c.box, roi)).map((c) => c.value))]
    : [];
  // No code, or two different codes in the frame: nothing to trust.
  const [value] = values;
  if (values.length !== 1 || value === undefined) return { state: reset(state), emit: null };
  if (value === state.last && now < state.ignoreUntil) return { state: reset(state), emit: null };

  const count = value === state.candidate ? state.count + 1 : 1;
  if (count >= STABLE_FRAMES) {
    return {
      state: { candidate: null, count: 0, last: value, ignoreUntil: now + IGNORE_MS },
      emit: value,
    };
  }
  return { state: { ...state, candidate: value, count }, emit: null };
}

/**
 * Maps a rectangle drawn on screen (container pixels) into the video's own pixels for a video
 * shown with `object-fit: cover`, which crops the long side.
 */
export function frameToVideoRect(
  container: { width: number; height: number },
  video: { width: number; height: number },
  rect: Rect,
): Rect {
  const scale = Math.max(container.width / video.width, container.height / video.height);
  const offX = (video.width * scale - container.width) / 2;
  const offY = (video.height * scale - container.height) / 2;
  return {
    x: (rect.x + offX) / scale,
    y: (rect.y + offY) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/** The on-screen scan frame: a square in the upper middle, clear of the result card below. */
export function scanFrame(width: number, height: number): Rect {
  const size = Math.round(Math.min(width * 0.74, height * 0.5, 320));
  return {
    x: Math.round((width - size) / 2),
    y: Math.round(height * 0.22),
    width: size,
    height: size,
  };
}
