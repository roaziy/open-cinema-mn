'use client';

import {
  type AdminHallDetail,
  generateSeats,
  HallGenParams,
  type SeatKind,
  seatViewStats,
} from '@open-cinema/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Labeled, Select, TextInput } from '@/components/ui/Inputs';
import { Notice } from '@/components/ui/Notice';
import { call, messageOf } from '@/lib/client-api';
import { DEFAULT_GEN, inferGen, parseAisles, sameGen } from '@/lib/hall-layout';
import { KIND_FILL, KIND_LABEL, KINDS, VIEW_LABEL } from './kinds';
import { type PlanSeat, SeatPlan } from './SeatPlan';
import { SideProfile } from './SideProfile';

type Raw = {
  rows: string;
  seatsPerRow: string;
  seatPitchM: string;
  rowSpacingM: string;
  aisleAfter: string;
  firstRowDistanceM: string;
  risePerRowM: string;
};

const toRaw = (g: HallGenParams): Raw => ({
  rows: String(g.rows),
  seatsPerRow: String(g.seatsPerRow),
  seatPitchM: String(g.seatPitchM),
  rowSpacingM: String(g.rowSpacingM),
  aisleAfter: g.aisleAfter.join(', '),
  firstRowDistanceM: String(g.firstRowDistanceM),
  risePerRowM: String(g.risePerRowM),
});

const seatKey = (row: string, n: number) => `${row}-${n}`;

type Tool = 'view' | SeatKind;

export function HallEditor({
  hall,
  branches,
  defaultBranchId,
}: {
  hall: AdminHallDetail | null;
  branches: { id: string; name: string }[];
  defaultBranchId?: string;
}) {
  const router = useRouter();
  const baseline = useMemo(() => (hall ? inferGen(hall.seats) : null), [hall]);
  const [name, setName] = useState(hall?.name ?? '');
  const [branchId, setBranchId] = useState(
    hall?.branchId ?? defaultBranchId ?? branches[0]?.id ?? '',
  );
  const [screenW, setScreenW] = useState(String(hall?.screen_width_m ?? 10));
  const [screenH, setScreenH] = useState(String(hall?.screen_height_m ?? 4.5));
  const [raw, setRaw] = useState<Raw>(toRaw(baseline ?? DEFAULT_GEN));
  const [pending, setPending] = useState<Map<string, SeatKind>>(new Map());
  const [tool, setTool] = useState<Tool>('view');
  const [selected, setSelected] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();
  const lastGen = useRef<HallGenParams>(baseline ?? DEFAULT_GEN);

  const parsed = HallGenParams.safeParse({
    rows: Number(raw.rows),
    seatsPerRow: Number(raw.seatsPerRow),
    seatPitchM: Number(raw.seatPitchM),
    rowSpacingM: Number(raw.rowSpacingM),
    aisleAfter: parseAisles(raw.aisleAfter),
    firstRowDistanceM: Number(raw.firstRowDistanceM),
    risePerRowM: Number(raw.risePerRowM),
  });
  const genValid = parsed.success;
  if (parsed.success) lastGen.current = parsed.data;
  const gen = lastGen.current;
  const regenerate = !!hall && !!baseline && !sameGen(gen, baseline);
  const fromScratch = !hall || regenerate;
  const locked = !!hall?.locked;
  const sw = Number(screenW) > 0 ? Number(screenW) : (hall?.screen_width_m ?? 10);
  const sh = Number(screenH) > 0 ? Number(screenH) : (hall?.screen_height_m ?? 4.5);
  const screenX = hall?.screen_x_m ?? 0;

  const seats: PlanSeat[] = useMemo(() => {
    if (fromScratch) {
      return generateSeats(gen).map((s) => {
        const key = seatKey(s.rowLabel, s.number);
        const kind = pending.get(key) ?? 'standard';
        return { ...s, key, kind, changed: kind !== 'standard' };
      });
    }
    return (hall?.seats ?? []).map((s) => {
      const key = seatKey(s.rowLabel, s.number);
      const kind = pending.get(key) ?? s.kind;
      return {
        key,
        rowLabel: s.rowLabel,
        number: s.number,
        x_m: s.x_m,
        y_m: s.y_m,
        z_m: s.z_m,
        kind,
        changed: kind !== s.kind,
      };
    });
  }, [fromScratch, gen, hall, pending]);

  const byKey = useMemo(() => new Map(seats.map((s) => [s.key, s])), [seats]);
  const counts = useMemo(() => {
    const c: Record<SeatKind, number> = { standard: 0, premium: 0, wheelchair: 0, blocked: 0 };
    for (const s of seats) c[s.kind]++;
    return c;
  }, [seats]);
  const stored = useMemo(
    () => new Map((hall?.seats ?? []).map((s) => [seatKey(s.rowLabel, s.number), s.kind])),
    [hall],
  );

  function paint(key: string) {
    const s = byKey.get(key);
    if (!s) return;
    setSelected(key);
    if (tool === 'view') return;
    setSaved(false);
    setPending((old) => {
      const next = new Map(old);
      const base = fromScratch ? 'standard' : (stored.get(key) ?? 'standard');
      if (tool === base) next.delete(key);
      else next.set(key, tool);
      return next;
    });
  }

  function paintRow(rowLabel: string) {
    if (tool === 'view') return;
    setSaved(false);
    setPending((old) => {
      const next = new Map(old);
      for (const s of seats) {
        if (s.rowLabel !== rowLabel) continue;
        const base = fromScratch ? 'standard' : (stored.get(s.key) ?? 'standard');
        if (tool === base) next.delete(s.key);
        else next.set(s.key, tool);
      }
      return next;
    });
  }

  const sel = selected ? (byKey.get(selected) ?? null) : null;
  const probe =
    sel ?? seats.find((s) => s.rowLabel === seats[Math.floor(seats.length / 2)]?.rowLabel) ?? null;
  const stats = sel
    ? seatViewStats(sel, { screen_width_m: sw, screen_height_m: sh, screen_x_m: screenX })
    : null;

  function save() {
    const problems: string[] = [];
    if (!name.trim()) problems.push('Заалны нэрээ оруулна уу.');
    if (!branchId) problems.push('Салбараа сонгоно уу.');
    if (!genValid) problems.push('Суудлын тохиргооны утгуудыг шалгана уу.');
    if (!(Number(screenW) > 0 && Number(screenH) > 0))
      problems.push('Дэлгэцийн хэмжээг шалгана уу.');
    if (problems.length) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    start(async () => {
      try {
        let detail: AdminHallDetail;
        if (!hall) {
          detail = await call<AdminHallDetail>('POST', '/admin/halls', {
            branchId,
            name: name.trim(),
            screen_width_m: Number(screenW),
            screen_height_m: Number(screenH),
            gen,
          });
        } else {
          detail = hall;
          const meta =
            name.trim() !== hall.name ||
            Number(screenW) !== hall.screen_width_m ||
            Number(screenH) !== hall.screen_height_m;
          if (meta) {
            detail = await call<AdminHallDetail>('PATCH', `/admin/halls/${hall.id}`, {
              name: name.trim(),
              screen_width_m: Number(screenW),
              screen_height_m: Number(screenH),
            });
          }
          if (regenerate) {
            detail = await call<AdminHallDetail>('PUT', `/admin/halls/${hall.id}/regenerate`, {
              gen,
            });
          }
        }
        const current = new Map(detail.seats.map((s) => [seatKey(s.rowLabel, s.number), s]));
        const changes = [...pending]
          .map(([key, kind]) => ({ seat: current.get(key), kind }))
          .filter((c) => c.seat && c.seat.kind !== c.kind)
          .map((c) => ({ seatId: (c.seat as { id: string }).id, kind: c.kind }));
        if (changes.length) {
          detail = await call<AdminHallDetail>('PATCH', `/admin/halls/${detail.id}/seats`, {
            changes,
          });
        }
        setPending(new Map());
        setSaved(true);
        if (!hall) router.replace(`/admin/halls/${detail.id}`);
        else router.refresh();
      } catch (err) {
        setErrors([messageOf(err)]);
        router.refresh();
      }
    });
  }

  const num = (k: keyof Raw, label: string, hint?: string, step = '1') => (
    <Labeled label={label} htmlFor={`g-${k}`} hint={hint}>
      <TextInput
        id={`g-${k}`}
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={raw[k]}
        disabled={locked}
        onChange={(e) => {
          setSaved(false);
          setRaw((r) => ({ ...r, [k]: e.target.value }));
        }}
      />
    </Labeled>
  );

  const dirty = pending.size > 0 || regenerate;

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-4">
        <section className="highlight space-y-4 rounded-panel border border-hairline bg-raised p-4">
          <Labeled label="Заалны нэр" htmlFor="h-name">
            <TextInput
              id="h-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </Labeled>
          {!hall && (
            <Labeled label="Салбар" htmlFor="h-branch">
              <Select id="h-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Labeled>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Дэлгэцийн өргөн (м)" htmlFor="h-sw">
              <TextInput
                id="h-sw"
                type="number"
                inputMode="decimal"
                step="0.5"
                min={1}
                value={screenW}
                onChange={(e) => setScreenW(e.target.value)}
              />
            </Labeled>
            <Labeled label="Дэлгэцийн өндөр (м)" htmlFor="h-sh">
              <TextInput
                id="h-sh"
                type="number"
                inputMode="decimal"
                step="0.5"
                min={1}
                value={screenH}
                onChange={(e) => setScreenH(e.target.value)}
              />
            </Labeled>
          </div>
        </section>

        <section className="highlight space-y-4 rounded-panel border border-hairline bg-raised p-4">
          <h2 className="text-[15px] font-semibold text-ink">Суудлын зохион байгуулалт</h2>
          {locked && (
            <p className="rounded-card border border-hue-yellow/30 bg-hue-yellow/10 px-3 py-2 text-[13px] text-body">
              Энэ заалны суудлаар тасалбар олгогдсон тул бүтцийг өөрчлөх боломжгүй. Суудлын төрлийг
              л будаж болно.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {num('rows', 'Эгнээ')}
            {num('seatsPerRow', 'Эгнээн дэх суудал')}
            {num('seatPitchM', 'Суудлын зай (м)', undefined, '0.05')}
            {num('rowSpacingM', 'Эгнээний зай (м)', undefined, '0.05')}
            {num('firstRowDistanceM', '1-р эгнээ хүртэл (м)', undefined, '0.1')}
            {num('risePerRowM', 'Эгнээ тутмын өндөр (м)', undefined, '0.05')}
          </div>
          <Labeled
            label="Явган замын байрлал"
            htmlFor="g-aisle"
            hint="Аль суудлын дараа зай гарахыг таслалаар. Жишээ нь 7, 14"
          >
            <TextInput
              id="g-aisle"
              value={raw.aisleAfter}
              disabled={locked}
              onChange={(e) => {
                setSaved(false);
                setRaw((r) => ({ ...r, aisleAfter: e.target.value }));
              }}
            />
          </Labeled>
          {!genValid && (
            <Notice>
              Суудлын тохиргооны утгуудыг шалгана уу. Сүүлийн зөв утгаар харуулж байна.
            </Notice>
          )}
        </section>
      </div>

      <div className="min-w-0 space-y-4">
        <section className="highlight rounded-panel border border-hairline bg-raised p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Багаж" className="flex flex-wrap gap-1.5">
              <ToolButton active={tool === 'view'} onClick={() => setTool('view')} label="Харах" />
              {KINDS.map((k) => (
                <ToolButton
                  key={k}
                  active={tool === k}
                  onClick={() => setTool(k)}
                  label={KIND_LABEL[k]}
                  swatch={KIND_FILL[k]}
                  count={counts[k]}
                />
              ))}
            </div>
            <p className="ml-auto text-[13px] text-muted tabular-nums">
              Нийт {seats.length} суудал
            </p>
          </div>
          {regenerate && (
            <p className="mb-3 rounded-card border border-hue-yellow/30 bg-hue-yellow/10 px-3 py-2 text-[13px] text-body">
              Шинэ зохион байгуулалтын урьдчилсан харагдац. Хадгалахад бүх суудал дахин үүсч, өмнөх
              будалт арилна.
            </p>
          )}
          <div className="overflow-hidden rounded-card border border-hairline bg-canvas p-3">
            <SeatPlan
              seats={seats}
              pitchM={gen.seatPitchM}
              screenWidthM={sw}
              screenXM={screenX}
              selected={selected}
              onPaint={paint}
              onPaintRow={paintRow}
              ariaLabel="Заалны суудлын зураг"
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            {tool === 'view'
              ? 'Суудал дээр дарж хажуугийн зүсэлт, харагдацыг үзнэ.'
              : `“${KIND_LABEL[tool]}” сонгосон: суудал дээр дарж эсвэл чирж будна, эгнээний үсэг дээр дарвал эгнээг бүхэлд нь будна.`}
          </p>
        </section>

        <section className="highlight grid gap-4 rounded-panel border border-hairline bg-raised p-4 lg:grid-cols-[minmax(0,1fr)_200px]">
          <div>
            <h2 className="mb-2 text-[15px] font-semibold text-ink">Хажуугийн зүсэлт</h2>
            <div className="rounded-card border border-hairline bg-canvas p-2">
              <SideProfile seats={seats} seat={probe} screenHeightM={sh} />
            </div>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Сонгосон суудал</dt>
              <dd className="font-medium text-ink">{sel ? `${sel.rowLabel}${sel.number}` : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Дэлгэц хүртэл</dt>
              <dd className="text-ink tabular-nums">
                {stats ? `${stats.distanceM.toFixed(1)} м` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Харах өнцөг</dt>
              <dd className="text-ink tabular-nums">
                {stats ? `${Math.round(stats.viewDeg)}°` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Төвөөс хазайлт</dt>
              <dd className="text-ink tabular-nums">
                {stats ? `${Math.round(stats.offCenterDeg)}°` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Үнэлгээ</dt>
              <dd className="text-ink">{stats ? VIEW_LABEL[stats.label] : 'Суудал сонгоно уу'}</dd>
            </div>
          </dl>
        </section>

        {errors.map((e) => (
          <Notice key={e}>{e}</Notice>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={save}
            disabled={busy || (!!hall && !dirty && !metaChanged(hall, name, screenW, screenH))}
          >
            {busy
              ? 'Хадгалж байна…'
              : !hall
                ? 'Заал үүсгэх'
                : regenerate
                  ? 'Суудлыг дахин үүсгэх'
                  : 'Хадгалах'}
          </Button>
          {dirty && !busy && (
            <span className="text-[13px] text-muted tabular-nums">
              {pending.size > 0 && `${pending.size} суудал будагдсан`}
            </span>
          )}
          {pending.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setPending(new Map())}>
              Будалтыг болиулах
            </Button>
          )}
          {saved && (
            <span role="status" className="text-[13px] text-success">
              Хадгаллаа
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function metaChanged(hall: AdminHallDetail, name: string, w: string, h: string): boolean {
  return (
    name.trim() !== hall.name ||
    Number(w) !== hall.screen_width_m ||
    Number(h) !== hall.screen_height_m
  );
}

function ToolButton({
  active,
  onClick,
  label,
  swatch,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  swatch?: string;
  count?: number;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: styled toggle inside a radiogroup
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`focus-ring inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors ${
        active
          ? 'border-action bg-action/15 text-ink'
          : 'border-hairline text-body hover:border-white/20'
      }`}
    >
      {swatch && (
        <span
          aria-hidden
          className="size-3 rounded-[4px] border border-white/15"
          style={{ background: swatch }}
        />
      )}
      {label}
      {count !== undefined && <span className="text-muted tabular-nums">{count}</span>}
    </button>
  );
}
