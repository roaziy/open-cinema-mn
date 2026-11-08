'use client';

import {
  type AdminHallDetail,
  generateSeats,
  HallGenParams,
  type SeatKind,
} from '@open-cinema/shared';
import { useMemo, useState } from 'react';
import { DEFAULT_GEN, inferGen, parseAisles, sameGen } from '@/lib/hall-layout';
import type { PlanSeat } from './SeatPlan';

export type Raw = {
  rows: string;
  seatsPerRow: string;
  seatPitchM: string;
  rowSpacingM: string;
  aisleAfter: string;
  firstRowDistanceM: string;
  risePerRowM: string;
};

export type Tool = 'view' | SeatKind;

const toRaw = (g: HallGenParams): Raw => ({
  rows: String(g.rows),
  seatsPerRow: String(g.seatsPerRow),
  seatPitchM: String(g.seatPitchM),
  rowSpacingM: String(g.rowSpacingM),
  aisleAfter: g.aisleAfter.join(', '),
  firstRowDistanceM: String(g.firstRowDistanceM),
  risePerRowM: String(g.risePerRowM),
});

/** Parses what is typed; aisles are normalised for the row length so equal layouts compare equal. */
function parseRaw(raw: Raw) {
  const seatsPerRow = Number(raw.seatsPerRow);
  return HallGenParams.safeParse({
    rows: Number(raw.rows),
    seatsPerRow,
    seatPitchM: Number(raw.seatPitchM),
    rowSpacingM: Number(raw.rowSpacingM),
    aisleAfter: parseAisles(raw.aisleAfter, seatsPerRow),
    firstRowDistanceM: Number(raw.firstRowDistanceM),
    risePerRowM: Number(raw.risePerRowM),
  });
}

export const seatKey = (row: string, n: number) => `${row}-${n}`;

/**
 * Everything the hall editor edits, in one place: the typed generator values (and the last valid
 * parse of them), unsaved seat painting, and the seats the plan shows. The plan regenerates only
 * when the generator values change, not on every paint move.
 */
export function useHallDraft(hall: AdminHallDetail | null) {
  const baseline = useMemo(() => (hall ? inferGen(hall.seats) : null), [hall]);
  const [raw, setRawState] = useState<Raw>(toRaw(baseline ?? DEFAULT_GEN));
  const [gen, setGen] = useState<HallGenParams>(baseline ?? DEFAULT_GEN);
  const [genValid, setGenValid] = useState(true);
  const [pending, setPending] = useState<Map<string, SeatKind>>(new Map());
  const [tool, setTool] = useState<Tool>('view');
  const [selected, setSelected] = useState<string | null>(null);

  const regenerate = !!hall && !!baseline && !sameGen(gen, baseline);
  const fromScratch = !hall || regenerate;

  const base = useMemo(
    () =>
      fromScratch
        ? generateSeats(gen).map((s) => ({ ...s, key: seatKey(s.rowLabel, s.number) }))
        : (hall?.seats ?? []).map((s) => ({ ...s, key: seatKey(s.rowLabel, s.number) })),
    [fromScratch, gen, hall],
  );

  const seats: PlanSeat[] = useMemo(
    () =>
      base.map((s) => {
        const kind = pending.get(s.key) ?? s.kind;
        return { ...s, kind, changed: kind !== s.kind };
      }),
    [base, pending],
  );
  const byKey = useMemo(() => new Map(seats.map((s) => [s.key, s])), [seats]);
  const counts = useMemo(() => {
    const c: Record<SeatKind, number> = { standard: 0, premium: 0, wheelchair: 0, blocked: 0 };
    for (const s of seats) c[s.kind]++;
    return c;
  }, [seats]);

  function setRaw(key: keyof Raw, value: string) {
    const next = { ...raw, [key]: value };
    setRawState(next);
    const parsed = parseRaw(next);
    setGenValid(parsed.success);
    if (parsed.success) setGen(parsed.data);
  }

  const setKinds = (keys: string[]) =>
    setPending((old) => {
      const next = new Map(old);
      const stored = new Map(base.map((s) => [s.key, s.kind]));
      for (const k of keys) {
        if (tool === 'view') break;
        if (tool === stored.get(k)) next.delete(k);
        else next.set(k, tool);
      }
      return next;
    });

  return {
    raw,
    setRaw,
    gen,
    genValid,
    regenerate,
    fromScratch,
    seats,
    counts,
    pending,
    clearPending: () => setPending(new Map()),
    tool,
    setTool,
    selected,
    selectedSeat: selected ? (byKey.get(selected) ?? null) : null,
    paint(key: string) {
      if (!byKey.has(key)) return;
      setSelected(key);
      setKinds([key]);
    },
    paintRow(rowLabel: string) {
      setKinds(seats.filter((s) => s.rowLabel === rowLabel).map((s) => s.key));
    },
  };
}

export type HallDraft = ReturnType<typeof useHallDraft>;
