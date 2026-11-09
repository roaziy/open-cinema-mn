import { generateSeats, SCREEN_BOTTOM_M } from '@open-cinema/shared';
import { describe, expect, it } from 'vitest';
import { hallDepth, hallExtents, hallHalfWidth, rowsOf, stepSpans } from './camera-math';
import {
  floorAt,
  instanceBox,
  type KitName,
  kitOf,
  layoutRoom,
  moduleOf,
  type RoomInput,
  roomBudget,
  screenOpening,
  screenRect,
  walkways,
  washLights,
} from './room-kit-layout';
import { ROOM_KITS } from './room-kits';
import { aisleCentres } from './room-layout';

const KITS: KitName[] = ['standard', 'imax', 'dolby'];

/** A hall the way the seed builds one: rows x seats, an aisle, a rake, a screen sized to the row. */
function hallInput(
  rows: number,
  perRow: number,
  aisleAfter: number[],
  screenWidth: number,
): RoomInput {
  const gen = generateSeats({
    rows,
    seatsPerRow: perRow,
    seatPitchM: 0.55,
    rowSpacingM: 1.05,
    aisleAfter,
    firstRowDistanceM: 4.5,
    risePerRowM: 0.2,
  });
  const seats = gen.map((s) => ({ ...s, id: `${s.rowLabel}${s.number}` }));
  const ext = hallExtents(seats);
  const hall = { screen_width_m: screenWidth, screen_height_m: screenWidth * 0.42, screen_x_m: 0 };
  const half = hallHalfWidth(ext, hall);
  const depth = hallDepth(ext);
  return {
    half,
    depth,
    wallH: ext.maxZ + 6,
    screen: {
      width: hall.screen_width_m,
      height: hall.screen_height_m,
      x: 0,
      bottom: SCREEN_BOTTOM_M,
    },
    steps: stepSpans(rowsOf(seats), depth),
    aisleXs: aisleCentres(seats.map((s) => s.x_m)),
    seats,
  };
}

const SEED = hallInput(12, 14, [7], 4 + 14 * 0.45);
const IMAX = hallInput(14, 18, [6, 12], 14);

const EPS = 1e-6;
const overlap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.min(a1, b1) - Math.max(a0, b0);

/** Every instance of every layout key with its world box. */
function boxes(kit: KitName, input: RoomInput) {
  const layout = layoutRoom(kit, input);
  return Object.entries(layout).flatMap(([key, list]) =>
    list.map((inst) => ({ key, inst, box: instanceBox(kit, key, inst) })),
  );
}

describe('kitOf', () => {
  it('uses the IMAX kit for IMAX showtimes and the standard room for everything else', () => {
    expect(kitOf('IMAX')).toBe('imax');
    expect(kitOf('2D')).toBe('standard');
    expect(kitOf('3D')).toBe('standard');
    expect(kitOf(undefined)).toBe('standard');
    expect(kitOf('')).toBe('standard');
  });
});

describe.each(KITS)('layoutRoom (%s kit)', (kit) => {
  for (const [name, input] of [
    ['seed hall', SEED],
    ['imax hall', IMAX],
  ] as const) {
    describe(name, () => {
      const all = boxes(kit, input);

      it('only places modules the kit has', () => {
        for (const key of Object.keys(layoutRoom(kit, input))) {
          expect(Object.keys(ROOM_KITS[kit].modules)).toContain(moduleOf(key));
        }
      });

      it('puts nothing outside the room box', () => {
        const { half, depth, wallH } = input;
        for (const { key, box } of all) {
          const where = `${kit} ${key} ${JSON.stringify(box)}`;
          expect(box.min[0], where).toBeGreaterThanOrEqual(-half - EPS);
          expect(box.max[0], where).toBeLessThanOrEqual(half + EPS);
          expect(box.min[2], where).toBeGreaterThanOrEqual(-EPS);
          expect(box.max[2], where).toBeLessThanOrEqual(depth + EPS);
          expect(box.min[1], where).toBeGreaterThanOrEqual(-EPS);
          expect(box.max[1], where).toBeLessThanOrEqual(wallH + EPS);
        }
      });

      it('covers each side wall without gaps or overlaps', () => {
        const { half, depth } = input;
        for (const side of [-1, 1]) {
          const tiles = all
            .filter(
              (t) =>
                t.key === 'WallPanel' &&
                Math.abs(t.box.min[0] - (side < 0 ? -half : half - 0.04)) < 1e-3 &&
                t.box.min[2] < depth - 0.5 &&
                t.box.max[2] > 0.5 &&
                Math.abs(t.inst.x - side * half) < EPS,
            )
            // one row of the wall: the tiles standing on the floor
            .filter((t) => Math.abs(t.box.min[1]) < EPS)
            .sort((a, b) => a.box.min[2] - b.box.min[2]);
          expect(tiles.length).toBeGreaterThan(8);
          expect(tiles[0]?.box.min[2]).toBeCloseTo(0, 6);
          for (let i = 1; i < tiles.length; i++) {
            expect((tiles[i] as (typeof tiles)[number]).box.min[2]).toBeCloseTo(
              (tiles[i - 1] as (typeof tiles)[number]).box.max[2],
              6,
            );
          }
          expect(tiles[tiles.length - 1]?.box.max[2]).toBeCloseTo(depth, 6);
        }
      });

      it('covers the side walls floor to ceiling', () => {
        const { half, wallH } = input;
        for (const side of [-1, 1]) {
          const col = all.filter(
            (t) =>
              t.key === 'WallPanel' &&
              Math.abs(t.inst.x - side * half) < EPS &&
              Math.abs(t.inst.ry - (side < 0 ? 0 : Math.PI)) < EPS &&
              t.box.min[2] < 0.5 &&
              t.box.max[2] > 0,
          );
          const rows = col.sort((a, b) => a.box.min[1] - b.box.min[1]);
          expect(rows[0]?.box.min[1]).toBeCloseTo(0, 6);
          for (let i = 1; i < rows.length; i++) {
            expect((rows[i] as (typeof rows)[number]).box.min[1]).toBeCloseTo(
              (rows[i - 1] as (typeof rows)[number]).box.max[1],
              6,
            );
          }
          expect(rows[rows.length - 1]?.box.max[1]).toBeCloseTo(wallH, 6);
        }
        // the back wall is covered across the whole width
        const back = all.filter(
          (t) =>
            t.key === 'WallPanel' &&
            Math.abs(t.inst.ry - Math.PI / 2) < EPS &&
            Math.abs(t.box.min[1]) < EPS,
        );
        const total = back.reduce((s, t) => s + (t.box.max[0] - t.box.min[0]), 0);
        expect(total).toBeCloseTo(half * 2, 5);
      });

      it('leaves the screen and its masking open', () => {
        const screen = screenRect(input);
        const open = screenOpening(kit, input);
        for (const t of all) {
          if (t.key === 'ScreenBorderH') continue;
          // anything on the screen wall (within the Curtain's depth of it)
          if (t.box.min[2] > 0.2) continue;
          const w = overlap(t.box.min[0], t.box.max[0], open.x0, open.x1);
          const h = overlap(t.box.min[1], t.box.max[1], open.y0, open.y1);
          expect(w > 1e-4 && h > 1e-4, `${t.key} covers the opening`).toBe(false);
        }
        // the masking border surrounds the screen but never covers it
        const borders = all.filter((t) => t.key === 'ScreenBorderH');
        expect(borders).toHaveLength(4);
        for (const b of borders) {
          const w = overlap(b.box.min[0], b.box.max[0], screen.x0, screen.x1);
          const h = overlap(b.box.min[1], b.box.max[1], screen.y0, screen.y1);
          expect(w > 1e-4 && h > 1e-4).toBe(false);
        }
        // ...and together they span the whole ring: the opening's extent
        expect(Math.min(...borders.map((b) => b.box.min[0]))).toBeCloseTo(open.x0, 6);
        expect(Math.max(...borders.map((b) => b.box.max[0]))).toBeCloseTo(open.x1, 6);
        expect(Math.max(...borders.map((b) => b.box.max[1]))).toBeCloseTo(open.y1, 6);
      });

      it('sits the step nosings on the step edges', () => {
        const nosings = layoutRoom(kit, input).StepNosing ?? [];
        expect(nosings.length).toBeGreaterThan(0);
        const edges = new Map(input.steps.slice(1).map((s) => [s.from.toFixed(6), s.height]));
        for (const n of nosings) {
          expect(edges.has(n.z.toFixed(6))).toBe(true);
          expect(n.y).toBeCloseTo(edges.get(n.z.toFixed(6)) as number, 6);
          expect(n.ry).toBe(0);
        }
        // every step edge (but the first, against the screen wall) has one
        const have = new Set(nosings.map((n) => n.z.toFixed(6)));
        for (const key of edges.keys()) expect(have.has(key)).toBe(true);
        // and covers at least the width of the aisles
        for (const w of walkways(input)) {
          const s = input.steps[3] as RoomInput['steps'][number];
          const spans = nosings
            .filter((n) => Math.abs(n.z - s.from) < EPS)
            .map((n) => [n.x, n.x + n.sx] as const);
          expect(spans.some(([a, b]) => a <= w.c - w.hw + 1e-6 && b >= w.c + w.hw - 1e-6)).toBe(
            true,
          );
        }
      });

      it('puts exit signs at the rear corners and near the screen', () => {
        const signs = layoutRoom(kit, input).ExitSign ?? [];
        const { half, depth } = input;
        for (const side of [-1, 1]) {
          const rear = signs.filter((s) => Math.abs(s.x - side * half) < EPS && s.z > depth - 2);
          expect(rear).toHaveLength(1);
          const front = signs.filter((s) => Math.abs(s.x - side * half) < EPS && s.z < 3);
          expect(front).toHaveLength(1);
          const at = rear[0] as (typeof signs)[number];
          // 2.2 to 2.4 m above the floor under it
          expect(at.y - floorAt(input.steps, at.z)).toBeGreaterThanOrEqual(2.2);
          expect(at.y - floorAt(input.steps, at.z)).toBeLessThanOrEqual(2.4);
          expect(at.ry).toBeCloseTo(side < 0 ? 0 : Math.PI);
        }
      });

      it('lays a downlight about every 25 square metres of ceiling', () => {
        const lights = layoutRoom(kit, input).Downlight ?? [];
        const area = input.half * 2 * input.depth;
        expect(lights.length).toBeGreaterThanOrEqual(Math.floor(area / 25 / 1.5));
        expect(lights.length).toBeLessThanOrEqual(10);
        for (const l of lights) expect(l.y).toBeLessThan(input.wallH);
      });
    });
  }
});

describe('standard kit extras', () => {
  const { half, depth } = SEED;
  const layout = layoutRoom('standard', SEED);

  it('hangs sconces along each side wall: 3 m from the screen to 2 m before the back wall', () => {
    const sconces = layout.Sconce ?? [];
    const perSide = Math.ceil((depth - 5) / 4.5) + 1;
    expect(sconces).toHaveLength(perSide * 2);
    for (const side of [-1, 1]) {
      const zs = sconces
        .filter((s) => Math.sign(s.x) === side)
        .map((s) => s.z)
        .sort((a, b) => a - b);
      expect(zs[0]).toBeCloseTo(3, 6);
      expect(zs[zs.length - 1]).toBeCloseTo(depth - 2, 6);
      for (let i = 1; i < zs.length; i++) {
        expect((zs[i] as number) - (zs[i - 1] as number)).toBeLessThanOrEqual(4.5 + 1e-6);
      }
    }
    expect(sconces.every((s) => Math.abs(Math.abs(s.x) - half) < EPS)).toBe(true);
  });

  it('scales the sconce count with the wall length', () => {
    const short = layoutRoom('standard', hallInput(6, 10, [5], 8)).Sconce ?? [];
    const long = layoutRoom('standard', hallInput(20, 10, [5], 8)).Sconce ?? [];
    expect(long.length).toBeGreaterThan(short.length);
  });

  it('has curtains beside the screen, a valance above it and black masking under it', () => {
    const curtains = layout.Curtain ?? [];
    expect(curtains.length).toBeGreaterThan(8);
    const open = screenOpening('standard', SEED);
    expect(curtains.some((c) => c.y >= open.y1 - 1e-6)).toBe(true);
    // nothing red under the screen: the strip below it is the velvet masking, floor to opening
    const under = (c: { x: number; sz: number }) =>
      c.x >= open.x0 - 1e-6 && c.x + c.sz <= open.x1 + 1e-6;
    expect(curtains.some((c) => under(c) && c.y < open.y0 - 1e-6)).toBe(false);
    const fill = layout.MaskFill ?? [];
    expect(fill.length).toBeGreaterThan(0);
    expect(Math.min(...fill.map((f) => f.y))).toBeCloseTo(0, 6);
    expect(Math.max(...fill.map((f) => f.y + f.sy * 0.5))).toBeCloseTo(open.y0, 6);
  });

  it('keeps the thin-masked kits free of curtains, sconces and railings', () => {
    for (const kit of ['imax', 'dolby'] as const) {
      const l = layoutRoom(kit, SEED);
      expect(l.Curtain).toBeUndefined();
      expect(l.Sconce).toBeUndefined();
    }
    // per-step handrails read as broken bars across the seat blocks: the aisles stay open
    for (const kit of ['standard', 'imax', 'dolby'] as const)
      expect(layoutRoom(kit, IMAX).Railing).toBeUndefined();
  });
});

describe('imax and dolby kits', () => {
  it('puts a nosing along the whole row in dolby, and only at the aisles in imax', () => {
    const dolby = layoutRoom('dolby', SEED).StepNosing ?? [];
    expect(dolby).toHaveLength(SEED.steps.length - 1);
    for (const n of dolby) expect(n.sx).toBeGreaterThan(SEED.half * 2 - 0.2);
    const imax = layoutRoom('imax', SEED).StepNosing ?? [];
    expect(imax.length).toBeGreaterThan(SEED.steps.length - 1);
    for (const n of imax) expect(n.sx).toBeLessThan(SEED.half);
  });

  it('adds the dolby ceiling speaker arrays at +-W/4, facing down', () => {
    const arrays = layoutRoom('dolby', SEED).SpeakerCeiling ?? [];
    expect(arrays.length).toBeGreaterThanOrEqual(4);
    for (const a of arrays) {
      expect(Math.abs(Math.abs(a.x) - SEED.half / 2)).toBeLessThan(EPS);
      const box = instanceBox('dolby', 'SpeakerCeiling', a);
      // hangs below the ceiling plane
      expect(box.max[1]).toBeLessThanOrEqual(SEED.wallH + EPS);
      expect(box.min[1]).toBeLessThan(box.max[1] - 0.2);
    }
  });
});

describe('washLights', () => {
  it('is warm for the standard room, blue-violet for dolby, none for imax', () => {
    const std = washLights('standard', SEED);
    expect(std).toHaveLength(2);
    expect(std[0]?.color).toBe('#FFA757');
    const dolby = washLights('dolby', SEED);
    expect(dolby).toHaveLength(2);
    expect(dolby[0]?.color).toBe('#5B4BFF');
    expect(washLights('imax', SEED)).toEqual([]);
  });
  it('keeps them inside the room, one per side', () => {
    for (const kit of KITS) {
      for (const l of washLights(kit, SEED)) {
        expect(Math.abs(l.x)).toBeLessThan(SEED.half);
        expect(l.z).toBeGreaterThan(0);
        expect(l.z).toBeLessThan(SEED.depth);
        expect(l.y).toBeLessThan(SEED.wallH);
      }
      expect(washLights(kit, SEED).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('the kit data', () => {
  it('has every module the layout places, and lights data for each kit', () => {
    for (const kit of KITS) {
      const mods = ROOM_KITS[kit].modules as Record<string, unknown>;
      for (const m of [
        'Carpet',
        'CeilingPanel',
        'Downlight',
        'ExitSign',
        'ScreenBorderH',
        'Speaker',
        'StepLight',
        'StepNosing',
        'WallBase',
        'WallPanel',
      ]) {
        expect(mods[m], `${kit} ${m}`).toBeDefined();
      }
      expect(ROOM_KITS[kit].lights.length).toBeGreaterThan(5);
    }
  });
});

describe('roomBudget', () => {
  it('keeps the seed hall inside the phone budget', () => {
    for (const kit of ['standard', 'imax', 'dolby'] as const) {
      for (const input of [SEED, IMAX]) {
        const b = roomBudget(kit, layoutRoom(kit, input));
        expect(b.tris, `${kit} triangles`).toBeLessThanOrEqual(40_000);
        expect(b.draws, `${kit} draws`).toBeLessThanOrEqual(24);
      }
    }
  });
});
