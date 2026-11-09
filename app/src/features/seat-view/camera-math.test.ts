import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { layoutSeats } from '../../lib/seat-layout';
import {
  coverTransform,
  divePose,
  easeInOut,
  eyePosition,
  flightProgress,
  fovForAspect,
  hallDepth,
  hallExtents,
  lensRange,
  lerp3,
  mapFitOf,
  newDivePose,
  POV_NEAR_M,
  pickScreenSource,
  povFov,
  rowsOf,
  SEAT_TOP_M,
  safeTone,
  screenCenter,
  seatPlaneHeight,
  stepSpans,
  type TopDownPose,
  textureFits,
  topDownFromMap,
} from './camera-math';

const hall = { screen_width_m: 10, screen_height_m: 4.2, screen_x_m: 0 };

describe('easeInOut', () => {
  it('is 0 at the start, 1 at the end, 0.5 in the middle, and clamps', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(-3)).toBe(0);
    expect(easeInOut(7)).toBe(1);
  });
  it('is slow at the ends and monotonic', () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const v = easeInOut(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('flightProgress', () => {
  it('takes 1.5 s by default and finishes at once with Reduce Motion', () => {
    expect(flightProgress(750, false)).toBeCloseTo(0.5);
    expect(flightProgress(1500, false)).toBe(1);
    expect(flightProgress(0, true)).toBe(1);
  });
});

describe('eyePosition', () => {
  it('maps y_m to depth, z_m to height and adds the 1.15 m eye height', () => {
    expect(eyePosition({ x_m: 2, y_m: 9, z_m: 0.6 })).toEqual([2, 1.75, 9]);
  });
});

describe('screenCenter', () => {
  it('is half the screen height above the screen bottom', () => {
    expect(screenCenter({ ...hall, screen_x_m: 1 })).toEqual([1, 1.2 + 2.1, 0]);
  });
});

describe('hallExtents', () => {
  const seats = [
    { x_m: -4, y_m: 4, z_m: 0 },
    { x_m: 4, y_m: 12, z_m: 2.4 },
  ];
  it('reads hall extents', () => {
    expect(hallExtents(seats)).toEqual({ minX: -4, maxX: 4, minY: 4, maxY: 12, maxZ: 2.4 });
  });
});

describe('lerp3', () => {
  it('writes into the output without allocating', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(lerp3(out, [0, 0, 0], [10, 20, 30], 0.5)).toBe(out);
    expect(out).toEqual([5, 10, 15]);
  });
});

describe('screen texture fallback', () => {
  const base = { backdropUrl: null, posterUrl: '', tone: '#3A6EA5' };
  it('prefers the backdrop, then the poster', () => {
    expect(
      pickScreenSource({ ...base, backdropUrl: 'https://x/b.jpg', posterUrl: 'https://x/p.jpg' }),
    ).toEqual({
      kind: 'remote',
      url: 'https://x/b.jpg',
    });
    expect(pickScreenSource({ ...base, posterUrl: 'https://x/p.jpg' })).toEqual({
      kind: 'remote',
      url: 'https://x/p.jpg',
    });
  });
  it('falls back to a flat film tone, neutral when the tone is malformed', () => {
    expect(pickScreenSource(base)).toEqual({ kind: 'flat', color: '#3A6EA5' });
    expect(pickScreenSource({ ...base, tone: 'red' })).toEqual({ kind: 'flat', color: '#8E8E93' });
    expect(safeTone('nope')).toBe('#8E8E93');
  });
});

describe('fovForAspect', () => {
  it('widens for portrait canvases within 50..85 degrees', () => {
    expect(fovForAspect(0.46)).toBe(85);
    expect(fovForAspect(0.75)).toBeGreaterThan(fovForAspect(1.5));
    expect(fovForAspect(3)).toBe(50);
    const mid = fovForAspect(1);
    expect(mid).toBeGreaterThanOrEqual(50);
    expect(mid).toBeLessThanOrEqual(85);
  });
});

describe('coverTransform', () => {
  it('crops the sides of a wider image and the top/bottom of a taller one', () => {
    expect(coverTransform(2, 1)).toEqual({ rx: 0.5, ry: 1, ox: 0.25, oy: 0 });
    expect(coverTransform(1, 2)).toEqual({ rx: 1, ry: 0.5, ox: 0, oy: 0.25 });
    expect(coverTransform(1.5, 1.5)).toEqual({ rx: 1, ry: 1, ox: 0, oy: 0 });
    expect(coverTransform(0, 1)).toEqual({ rx: 1, ry: 1, ox: 0, oy: 0 });
  });
});

describe('rows and steps', () => {
  const seats = [
    { rowLabel: 'B', x_m: 0, y_m: 6, z_m: 0.6 },
    { rowLabel: 'A', x_m: 0, y_m: 4, z_m: 0 },
    { rowLabel: 'A', x_m: 1, y_m: 4.2, z_m: 0 },
    { rowLabel: 'C', x_m: 0, y_m: 8, z_m: 1.2 },
  ];
  it('groups by row label, nearest the screen first, averaging curved rows', () => {
    const rows = rowsOf(seats);
    expect(rows.map((r) => r.label)).toEqual(['A', 'B', 'C']);
    expect(rows[0]?.y).toBeCloseTo(4.1);
  });
  it('gives each row a step from halfway to its neighbours, with a minimum thickness', () => {
    const rows = rowsOf(seats);
    const depth = hallDepth(hallExtents(seats));
    expect(depth).toBe(9.5);
    const spans = stepSpans(rows, depth);
    expect(spans[0]).toEqual({ from: 0, to: (4.1 + 6) / 2, height: 0.05 });
    expect(spans[1]?.from).toBe(spans[0]?.to);
    expect(spans[2]).toEqual({ from: 7, to: 9.5, height: 1.2 });
  });
});

describe('textureFits', () => {
  it('rejects empty, oversize and over-cap images', () => {
    expect(textureFits(960, 1440, 8192)).toBe(true);
    expect(textureFits(0, 10, 8192)).toBe(false);
    expect(textureFits(5000, 100, 8192)).toBe(false);
    expect(textureFits(3000, 100, 2048)).toBe(false);
    expect(textureFits(100, 100, 0)).toBe(true);
  });
});

// A small hall: 4 columns 0.55 m apart with an aisle, 3 rows 1.1 m apart.
const seatsOf = () => {
  const out: {
    id: string;
    rowLabel: string;
    kind: 'standard';
    x_m: number;
    y_m: number;
    z_m: number;
  }[] = [];
  for (const [r, y] of [4, 5.1, 6.2].entries()) {
    for (const x of [-1.65, -1.1, 0.55, 1.1]) {
      out.push({
        id: `${r}${x}`,
        rowLabel: 'ABC'[r] as string,
        kind: 'standard',
        x_m: x,
        y_m: y,
        z_m: r * 0.3,
      });
    }
  }
  return out;
};
const GUTTER = 22;
const ARC_H = 90;

describe('lensRange', () => {
  it('keeps the seat-height near plane low and pushes it out when high above the hall', () => {
    expect(lensRange(2).near).toBe(POV_NEAR_M);
    expect(lensRange(100).near).toBeGreaterThan(20);
    expect(lensRange(100).far).toBeGreaterThan(200);
    expect(lensRange(50).near).toBeLessThan(lensRange(100).near);
  });
});

describe('mapFitOf', () => {
  it('recovers the layout scale and the row pitch', () => {
    const layout = layoutSeats(seatsOf() as never, 330);
    const fit = mapFitOf(layout.slots, layout.size, layout.ppm, { x: GUTTER, y: ARC_H });
    expect(fit.ppmX).toBeCloseTo(layout.ppm);
    // 3 rows 1.1 m apart are drawn rowStep px apart.
    expect(fit.ppmY).toBeCloseTo(layout.rowStep / 1.1);
    const s = layout.slots[5];
    expect(fit.x0 + fit.ppmX * (s?.seat.x_m ?? 0)).toBeCloseTo(
      GUTTER + (s?.left ?? 0) + layout.size / 2,
    );
    expect(fit.y0 + fit.ppmY * (s?.seat.y_m ?? 0)).toBeCloseTo(
      ARC_H + (s?.top ?? 0) + layout.size / 2,
    );
  });
  it('survives a hall with a single row', () => {
    const one = seatsOf().filter((s) => s.rowLabel === 'A');
    const layout = layoutSeats(one as never, 330);
    const fit = mapFitOf(layout.slots, layout.size, layout.ppm, { x: GUTTER, y: ARC_H });
    expect(fit.ppmY).toBeCloseTo(layout.ppm);
  });
});

describe('topDownFromMap', () => {
  // Project a hall point through the returned camera with real three.js and compare with where
  // the 2D map draws that seat after the given pan/zoom.
  function check(
    view: { scale: number; tx: number; ty: number },
    offset: { x: number; y: number },
    canvas = { w: 390, h: 640 },
  ) {
    const seats = seatsOf();
    const layout = layoutSeats(seats as never, 330);
    const contentW = layout.width + GUTTER * 2;
    const contentH = ARC_H + layout.height + 24;
    const fit = mapFitOf(layout.slots, layout.size, layout.ppm, { x: GUTTER, y: ARC_H });
    const viewW = 390;
    const viewH = 520;
    const canvasW = canvas.w;
    const canvasH = canvas.h;
    const pose = topDownFromMap({
      fit,
      view: { ...view, viewW, viewH, contentW, contentH },
      canvasW,
      canvasH,
      offsetX: offset.x,
      offsetY: offset.y,
      planeY: seatPlaneHeight(seats),
    });
    const cam = new THREE.PerspectiveCamera(pose.fov, canvasW / canvasH, 0.5, 600);
    cam.position.set(...pose.position);
    cam.up.set(0, 0, -1);
    cam.lookAt(...pose.target);
    cam.updateMatrixWorld();
    cam.projectionMatrix.elements[5] = (cam.projectionMatrix.elements[5] ?? 0) * pose.squash;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    for (const slot of layout.slots) {
      const p = new THREE.Vector3(slot.seat.x_m, slot.seat.z_m + 0.5, slot.seat.y_m).project(cam);
      const gotX = ((p.x + 1) / 2) * canvasW;
      const gotY = ((1 - p.y) / 2) * canvasH;
      const wantX =
        offset.x +
        viewW / 2 +
        view.tx +
        view.scale * (GUTTER + slot.left + layout.size / 2 - contentW / 2);
      const wantY =
        offset.y +
        viewH / 2 +
        view.ty +
        view.scale * (ARC_H + slot.top + layout.size / 2 - contentH / 2);
      expect(Math.abs(gotX - wantX)).toBeLessThan(3);
      // Rows are fitted, not exact; the fit error stays under half a pixel here.
      expect(Math.abs(gotY - wantY)).toBeLessThan(2.5);
    }
  }
  it('lines seats up with the 2D map at the fitted zoom', () => {
    check({ scale: 1, tx: 0, ty: 0 }, { x: 0, y: 60 });
  });
  it('lines up when the canvas is the whole window and the map sits in the middle of it', () => {
    check({ scale: 1.6, tx: 20, ty: -30 }, { x: 0, y: 190 }, { w: 390, h: 844 });
  });
  it('follows pan and zoom, and a canvas offset from the viewport', () => {
    check({ scale: 2.4, tx: -35, ty: 48 }, { x: 0, y: 112 });
  });
  it('looks straight down with the screen at the top and a narrow lens', () => {
    const pose = topDownFromMap({
      fit: { x0: 0, ppmX: 20, y0: 0, ppmY: 20 },
      view: { scale: 1, tx: 0, ty: 0, viewW: 300, viewH: 500, contentW: 300, contentH: 500 },
      canvasW: 300,
      canvasH: 500,
      offsetX: 0,
      offsetY: 0,
      planeY: 0.6,
    });
    expect(pose.fov).toBeLessThan(20);
    expect(pose.target[1]).toBe(0);
    expect(pose.position[0]).toBeCloseTo(pose.target[0]);
    expect(pose.position[2]).toBeCloseTo(pose.target[2]);
    expect(pose.position[1]).toBeGreaterThan(20);
    expect(pose.squash).toBe(1);
  });
});

describe('seatPlaneHeight', () => {
  it('is the mean seat height plus the seat tops', () => {
    expect(seatPlaneHeight([{ z_m: 0 }, { z_m: 2 }])).toBeCloseTo(1 + SEAT_TOP_M);
    expect(seatPlaneHeight([])).toBe(SEAT_TOP_M);
  });
});

describe('divePose', () => {
  const top: TopDownPose = { position: [0.4, 105, 7], target: [0.4, 0, 7], fov: 14, squash: 0.62 };
  const eye: [number, number, number] = [-0.55, 1.15 + 0.9, 11];
  const center = screenCenter(hall);
  const pov = 78;
  const at = (s: number) => divePose(s, top, eye, center, pov, newDivePose());

  function camera(s: number, aspect = 0.6) {
    const p = at(s);
    const cam = new THREE.PerspectiveCamera(p.fov, aspect, 0.1, 400);
    cam.position.set(...p.position);
    cam.up.set(...p.up);
    cam.lookAt(...p.target);
    cam.updateMatrixWorld();
    cam.projectionMatrix.elements[5] = (cam.projectionMatrix.elements[5] ?? 0) * p.squash;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    return cam;
  }

  it('starts exactly at the top-down pose and ends exactly at the seat', () => {
    const a = at(0);
    const b = at(1);
    for (let i = 0; i < 3; i++) expect(a.position[i]).toBeCloseTo(top.position[i] as number, 6);
    expect(a.fov).toBeCloseTo(14);
    expect(a.squash).toBeCloseTo(0.62);
    for (let i = 0; i < 3; i++) {
      expect(b.position[i]).toBeCloseTo(eye[i] as number, 6);
      expect(b.target[i]).toBeCloseTo(center[i] as number, 6);
    }
    expect(b.fov).toBeCloseTo(pov);
    expect(b.squash).toBe(1);
    expect(b.up[1]).toBeCloseTo(1);
    expect(Math.abs(b.up[0]) + Math.abs(b.up[2])).toBeCloseTo(0);
  });

  it('keeps the hall at a steady apparent size: no shrink then jump', () => {
    const half = 6;
    const widthAt = (s: number) => {
      const cam = camera(s);
      const l = new THREE.Vector3(-half, 0, 0).project(cam);
      const r = new THREE.Vector3(half, 0, 0).project(cam);
      return Math.abs(r.x - l.x);
    };
    const w0 = widthAt(0);
    let prev = w0;
    for (let i = 1; i <= 50; i++) {
      const w = widthAt(i / 50);
      // never shrinks by more than a ripple, never jumps between neighbouring steps
      expect(w).toBeGreaterThan(prev * 0.99);
      expect(w).toBeLessThan(prev * 1.12);
      expect(w).toBeGreaterThan(w0 * 0.95);
      prev = w;
    }
  });

  it('never looks past the screen wall', () => {
    for (let i = 0; i <= 50; i++) {
      const p = at(i / 50);
      // the look target stays between the screen centre and the top-down target
      expect(p.target[2]).toBeGreaterThanOrEqual(-1e-9);
      expect(p.target[2]).toBeLessThanOrEqual(top.target[2] + 1e-9);
      // the view ray meets the floor in front of the wall, or lands on the wall (floor up to a
      // little above the screen); it never goes over or past it
      const dir = new THREE.Vector3(...p.target).sub(new THREE.Vector3(...p.position)).normalize();
      const floorZ = dir.y < -1e-6 ? p.position[2] + dir.z * (-p.position[1] / dir.y) : Number.NaN;
      if (!(floorZ >= 0)) {
        const y = p.position[1] + dir.y * (-p.position[2] / dir.z);
        expect(y).toBeGreaterThanOrEqual(-0.5);
        expect(y).toBeLessThanOrEqual(8);
      }
    }
  });

  it('keeps the look direction away from the up vector', () => {
    for (let i = 0; i <= 50; i++) {
      const p = at(i / 50);
      const look = new THREE.Vector3(...p.target).sub(new THREE.Vector3(...p.position)).normalize();
      expect(Math.abs(look.dot(new THREE.Vector3(...p.up).normalize()))).toBeLessThan(0.999);
    }
  });
});

describe('povFov', () => {
  const asp = 0.46;
  it('shows the whole screen from the middle of the hall with a margin', () => {
    const eye: [number, number, number] = [0, 3.3, 20];
    const fov = povFov(eye, hall, asp);
    // the screen's edge must be inside the horizontal half-angle
    const halfH = Math.atan(Math.tan((fov * Math.PI) / 360) * asp);
    expect(halfH).toBeGreaterThan(Math.atan(hall.screen_width_m / 2 / 20));
    expect(fov).toBeLessThanOrEqual(100);
  });
  it('caps seats too close to see all of it at 100 degrees, and floors far seats at 50', () => {
    expect(povFov([0, 1.9, 3], hall, asp)).toBe(100);
    expect(povFov([0, 4, 30], hall, asp)).toBe(50);
  });
  it('widens as the seat moves toward the screen', () => {
    expect(povFov([0, 2.1, 16], hall, 0.6)).toBeLessThanOrEqual(povFov([0, 2.1, 9], hall, 0.6));
  });
});
