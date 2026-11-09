import { describe, expect, it } from 'vitest';
import {
  CROSSFADE_MS,
  HANDOFF_FROM,
  handoffLook,
  handoffProgress,
  heldScale,
  NOT_CLOSING,
} from './handoff';

describe('handoffLook', () => {
  it('does nothing when opening or before the close reaches the last stretch', () => {
    for (const d of [0, 0.1, 0.5, 1]) {
      const look = handoffLook(d, NOT_CLOSING);
      expect(look.landmarks).toBe(0);
      expect(look.morph).toBe(0);
      expect(look.light).toBe(1);
      expect(look.footprintX).toBe(1);
      expect(look.screen).toBe(1);
    }
    expect(handoffLook(HANDOFF_FROM, 1).landmarks).toBe(0);
    expect(handoffLook(0.9, 1).morph).toBe(0);
  });

  it('ends exactly at the 2D look', () => {
    const look = handoffLook(0, 1);
    expect(look.landmarks).toBe(1);
    expect(look.morph).toBe(1);
    expect(look.light).toBe(0);
    expect(look.screen).toBe(0);
    expect(look.footprintX).toBeCloseTo((0.55 * 0.86) / 0.52);
    expect(heldScale(look.morph, true)).toBeCloseTo(1);
    expect(heldScale(look.morph, false)).toBeCloseTo(1);
  });

  it('is monotonic as the camera comes down, and reversible (a pure function of progress)', () => {
    let prev = handoffLook(HANDOFF_FROM, 1);
    for (let i = 1; i <= 60; i++) {
      const d = HANDOFF_FROM * (1 - i / 60);
      const look = handoffLook(d, 1);
      expect(look.landmarks).toBeGreaterThanOrEqual(prev.landmarks);
      expect(look.morph).toBeGreaterThanOrEqual(prev.morph);
      expect(look.footprintX).toBeLessThanOrEqual(prev.footprintX);
      expect(heldScale(look.morph, true)).toBeLessThanOrEqual(heldScale(prev.morph, true));
      expect(look.screen).toBeLessThanOrEqual(prev.screen);
      prev = look;
    }
    // reversible: the look at a progress does not depend on the path taken to it
    for (const d of [0.25, 0.12, 0.05]) {
      const down = handoffLook(d, 1);
      handoffLook(0, 1);
      expect(handoffLook(d, 1)).toEqual(down);
    }
  });

  it('lets the landmarks arrive before the seats finish morphing', () => {
    for (let i = 1; i < 20; i++) {
      const d = HANDOFF_FROM * (1 - i / 20);
      const look = handoffLook(d, 1);
      if (look.morph < 1) expect(look.landmarks).toBeGreaterThanOrEqual(look.morph - 1e-9);
    }
  });
});

describe('handoffProgress and the crossfade window', () => {
  it('runs from 0 at the threshold to 1 at the map', () => {
    expect(handoffProgress(HANDOFF_FROM, 1)).toBe(0);
    expect(handoffProgress(HANDOFF_FROM / 2, 1)).toBeCloseTo(0.5);
    expect(handoffProgress(0, 1)).toBe(1);
  });
  it('crossfades over 450 ms', () => {
    expect(CROSSFADE_MS).toBe(450);
  });
});

describe('a close that begins near the map', () => {
  it('starts from the look it is in (no jump) and still ends at the 2D look', () => {
    for (const start of [0.25, 0.15, 0.05]) {
      const first = handoffLook(start, start);
      expect(first.landmarks).toBe(0);
      expect(first.morph).toBe(0);
      expect(first.screen).toBe(1);
      expect(handoffLook(0, start).landmarks).toBe(1);
      expect(handoffLook(0, start).morph).toBe(1);
      let prev = first.landmarks;
      for (let i = 1; i <= 30; i++) {
        const l = handoffLook(start * (1 - i / 30), start).landmarks;
        expect(l).toBeGreaterThanOrEqual(prev);
        prev = l;
      }
    }
  });
  it('is byte-identical to before when leaving from the seat', () => {
    for (const d of [0.3, 0.2, 0.1, 0]) {
      expect(handoffLook(d, 1)).toEqual(handoffLook(d, 0.9));
    }
  });
});
