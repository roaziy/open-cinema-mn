import { describe, expect, it } from 'vitest';
import {
  advance,
  centerInside,
  type Detected,
  frameToVideoRect,
  IGNORE_MS,
  initialStable,
  type Rect,
  type StableState,
} from '../lib/scan/stable';

const ROI: Rect = { x: 200, y: 100, width: 300, height: 300 };
const inside = (value: string): Detected => ({
  value,
  box: { x: 300, y: 200, width: 100, height: 100 },
});
const outside = (value: string): Detected => ({
  value,
  box: { x: 20, y: 20, width: 100, height: 100 },
});

function run(codesPerFrame: Detected[][], start = 0, step = 100, from?: StableState) {
  let state = from ?? initialStable;
  const emits: (string | null)[] = [];
  let now = start;
  for (const codes of codesPerFrame) {
    const r = advance(state, { codes, roi: ROI, now, paused: false });
    state = r.state;
    emits.push(r.emit);
    now += step;
  }
  return { state, emits, now };
}

describe('centerInside', () => {
  it('is true for a box centred in the frame and false when only its edge overlaps', () => {
    expect(centerInside({ x: 300, y: 200, width: 100, height: 100 }, ROI)).toBe(true);
    // overlaps the ROI but its centre (190,250) is left of it
    expect(centerInside({ x: 140, y: 200, width: 100, height: 100 }, ROI)).toBe(false);
    expect(centerInside({ x: 0, y: 0, width: 50, height: 50 }, ROI)).toBe(false);
  });
});

describe('advance: stable decode', () => {
  it('does not emit after 1 or 2 identical frames', () => {
    expect(run([[inside('A')]]).emits).toEqual([null]);
    expect(run([[inside('A')], [inside('A')]]).emits).toEqual([null, null]);
  });

  it('emits on the 3rd identical consecutive frame, once', () => {
    const { emits } = run([[inside('A')], [inside('A')], [inside('A')], [inside('A')]]);
    expect(emits).toEqual([null, null, 'A', null]);
  });

  it('a code whose centre is outside the frame never counts', () => {
    const { emits } = run([[outside('A')], [outside('A')], [outside('A')], [outside('A')]]);
    expect(emits.every((e) => e === null)).toBe(true);
  });

  it('a frame without the code resets the count (consecutive, not cumulative)', () => {
    const { emits } = run([[inside('A')], [inside('A')], [], [inside('A')], [inside('A')]]);
    expect(emits).toEqual([null, null, null, null, null]);
  });

  it('a different value resets the count', () => {
    const { emits } = run([
      [inside('A')],
      [inside('A')],
      [inside('B')],
      [inside('B')],
      [inside('B')],
    ]);
    expect(emits).toEqual([null, null, null, null, 'B']);
  });

  it('an outside code in the same frame does not disturb the inside one', () => {
    const f = [inside('A'), outside('Z')];
    expect(run([f, f, f]).emits).toEqual([null, null, 'A']);
  });

  it('two different codes inside the frame are ambiguous and never emit', () => {
    const f = [inside('A'), inside('B')];
    expect(run([f, f, f, f]).emits.every((e) => e === null)).toBe(true);
  });

  it('does nothing without a frame rectangle', () => {
    const r = advance(initialStable, { codes: [inside('A')], roi: null, now: 0, paused: false });
    expect(r.emit).toBeNull();
    expect(r.state.count).toBe(0);
  });
});

describe('advance: one read per code', () => {
  it('ignores the same token for 5 s after it was emitted', () => {
    const first = run([[inside('A')], [inside('A')], [inside('A')]]);
    expect(first.emits[2]).toBe('A');
    // keeps being held in front of the camera, frames 100 ms apart, until just before 5 s
    const frames = Array.from({ length: 45 }, () => [inside('A')]);
    const held = run(frames, 300, 100, first.state);
    expect(held.emits.every((e) => e === null)).toBe(true);
  });

  it('accepts the same token again once 5 s have passed', () => {
    const first = run([[inside('A')], [inside('A')], [inside('A')]]);
    const later = 200 + IGNORE_MS + 1;
    const again = run([[inside('A')], [inside('A')], [inside('A')]], later, 100, first.state);
    expect(again.emits).toEqual([null, null, 'A']);
  });

  it('accepts a different token straight away', () => {
    const first = run([[inside('A')], [inside('A')], [inside('A')]]);
    const next = run([[inside('B')], [inside('B')], [inside('B')]], 300, 100, first.state);
    expect(next.emits).toEqual([null, null, 'B']);
  });

  it('pausing (request or result card up) emits nothing and restarts the 5 s after it ends', () => {
    let s = run([[inside('A')], [inside('A')], [inside('A')]]).state;
    // card is up for 30 s
    for (let t = 1000; t <= 30_000; t += 1000) {
      const r = advance(s, { codes: [inside('A')], roi: ROI, now: t, paused: true });
      expect(r.emit).toBeNull();
      s = r.state;
    }
    // card closed at 30 s: still ignored for 5 s
    const soon = run(
      Array.from({ length: 40 }, () => [inside('A')]),
      30_100,
      100,
      s,
    );
    expect(soon.emits.every((e) => e === null)).toBe(true);
    const after = run([[inside('A')], [inside('A')], [inside('A')]], 36_000, 100, soon.state);
    expect(after.emits).toEqual([null, null, 'A']);
  });

  it('frames seen while paused do not count towards the 3', () => {
    let s = initialStable;
    s = advance(s, { codes: [inside('A')], roi: ROI, now: 0, paused: false }).state;
    s = advance(s, { codes: [inside('A')], roi: ROI, now: 100, paused: false }).state;
    s = advance(s, { codes: [inside('A')], roi: ROI, now: 200, paused: true }).state;
    const r = advance(s, { codes: [inside('A')], roi: ROI, now: 300, paused: false });
    expect(r.emit).toBeNull();
  });
});

describe('frameToVideoRect', () => {
  it('maps a container rectangle into video pixels for an object-cover video', () => {
    // 400x800 container, 1280x720 video: scale = 800/720, shown 1422x800, offset x = -511
    const r = frameToVideoRect(
      { width: 400, height: 800 },
      { width: 1280, height: 720 },
      { x: 100, y: 200, width: 200, height: 200 },
    );
    const scale = 800 / 720;
    expect(r.y).toBeCloseTo(200 / scale, 5);
    expect(r.width).toBeCloseTo(200 / scale, 5);
    expect(r.x).toBeCloseTo((100 + (1280 * scale - 400) / 2) / scale, 5);
  });

  it('is the identity when the container has the video aspect ratio', () => {
    const r = frameToVideoRect(
      { width: 640, height: 360 },
      { width: 1280, height: 720 },
      { x: 100, y: 50, width: 100, height: 100 },
    );
    expect(r).toEqual({ x: 200, y: 100, width: 200, height: 200 });
  });
});
