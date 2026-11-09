import { describe, expect, it } from 'vitest';
import { TILE_WIDTH_RATIO } from './handoff';
import { armsOf } from './seat-arms';
import { createSeatParts, fromBase64, MODEL_PITCH, MODEL_SEAT_WIDTH } from './seat-geometry';

const row = (label: string, xs: number[], y = 5, z = 0) =>
  xs.map((x) => ({ rowLabel: label, x_m: x, y_m: y, z_m: z }));

describe('armsOf', () => {
  it('puts a divider between neighbours and one at each end of a row', () => {
    const { arms, pitch } = armsOf(row('A', [0, 0.55, 1.1, 1.65]));
    expect(pitch).toBeCloseTo(0.55, 9);
    expect(arms.map((a) => Math.round(a.x * 1000) / 1000)).toEqual([
      -0.275, 0.275, 0.825, 1.375, 1.925,
    ]);
  });

  it('closes each side of an aisle with its own divider', () => {
    const { arms } = armsOf(row('A', [0, 0.55, 2.0, 2.55]));
    expect(arms.map((a) => Math.round(a.x * 1000) / 1000)).toEqual([
      -0.275, 0.275, 0.825, 1.725, 2.275, 2.825,
    ]);
  });

  it('keeps rows apart, and stands each divider at its seats’ depth and on the higher floor', () => {
    const { arms } = armsOf([...row('A', [0, 0.55], 4.5, 0), ...row('B', [0, 0.55], 5.55, 0.2)]);
    expect(arms).toHaveLength(6);
    expect(arms.filter((a) => a.z === 5.55).every((a) => a.y === 0.2)).toBe(true);
  });

  it('a lone seat gets a divider each side; no seats, no dividers', () => {
    expect(armsOf(row('A', [3])).arms.map((a) => a.x)).toEqual([2.725, 3.275]);
    expect(armsOf([]).arms).toEqual([]);
  });
});

describe('the seat model', () => {
  it('decodes base64 exactly', () => {
    expect([...fromBase64('AAECAw==')]).toEqual([0, 1, 2, 3]);
    expect([...fromBase64('/w==')]).toEqual([255]);
  });

  it('stands on the floor, centred, facing the screen (its back toward +z)', () => {
    const { fabric, shell, arm, whole } = createSeatParts();
    for (const g of [fabric, shell, arm, whole]) g.computeBoundingBox();
    const s = shell.boundingBox;
    const a = arm.boundingBox;
    if (!s || !a) throw new Error('no bounds');
    expect(Math.abs(s.min.x + s.max.x)).toBeLessThan(1e-3);
    expect(s.max.x - s.min.x).toBeCloseTo(MODEL_SEAT_WIDTH, 2);
    expect(s.min.y).toBeGreaterThan(0.2);
    expect(a.min.y).toBeCloseTo(0, 3);
    // the back shell is the furthest part from the screen
    expect(s.max.z).toBeGreaterThan(0.35);
    expect(s.min.z).toBeGreaterThan(-0.4);
    expect(whole.getAttribute('position').count).toBe(
      fabric.getAttribute('position').count + shell.getAttribute('position').count,
    );
    expect((fabric.getIndex()?.count ?? 0) / 3 + (shell.getIndex()?.count ?? 0) / 3).toBeLessThan(
      600,
    );
  });

  it('the 2D tile is the model seat narrowed by the hand-off', () => {
    expect(TILE_WIDTH_RATIO).toBeCloseTo((0.86 * MODEL_PITCH) / MODEL_SEAT_WIDTH, 3);
  });
});
