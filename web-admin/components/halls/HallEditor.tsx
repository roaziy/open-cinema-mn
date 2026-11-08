'use client';

import { type AdminHallDetail, seatViewStats } from '@open-cinema/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Labeled, Select, TextInput } from '@/components/ui/Inputs';
import { Notice } from '@/components/ui/Notice';
import { messageOf } from '@/lib/client-api';
import { GeneratorFields } from './GeneratorFields';
import { KIND_LABEL } from './kinds';
import { PaintToolbar } from './PaintToolbar';
import { SeatPlan } from './SeatPlan';
import { SeatStats } from './SeatStats';
import { SideProfile } from './SideProfile';
import { saveHall } from './saveHall';
import { useHallDraft } from './useHallDraft';

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
  const d = useHallDraft(hall);
  const [name, setName] = useState(hall?.name ?? '');
  const [branchId, setBranchId] = useState(
    hall?.branchId ?? defaultBranchId ?? branches[0]?.id ?? '',
  );
  const [screenW, setScreenW] = useState(String(hall?.screen_width_m ?? 10));
  const [screenH, setScreenH] = useState(String(hall?.screen_height_m ?? 4.5));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();

  const locked = !!hall?.locked;
  const sw = Number(screenW) > 0 ? Number(screenW) : (hall?.screen_width_m ?? 10);
  const sh = Number(screenH) > 0 ? Number(screenH) : (hall?.screen_height_m ?? 4.5);
  const screenX = hall?.screen_x_m ?? 0;
  const sel = d.selectedSeat;
  const probe = sel ?? d.seats[Math.floor(d.seats.length / 2)] ?? null;
  const stats = sel
    ? seatViewStats(sel, { screen_width_m: sw, screen_height_m: sh, screen_x_m: screenX })
    : null;
  const metaChanged =
    !!hall &&
    (name.trim() !== hall.name ||
      Number(screenW) !== hall.screen_width_m ||
      Number(screenH) !== hall.screen_height_m);
  const dirty = d.pending.size > 0 || d.regenerate || metaChanged;

  function save() {
    const problems: string[] = [];
    if (!name.trim()) problems.push('Заалны нэрээ оруулна уу.');
    if (!branchId) problems.push('Салбараа сонгоно уу.');
    if (!d.genValid) problems.push('Суудлын тохиргооны утгуудыг шалгана уу.');
    if (!(Number(screenW) > 0 && Number(screenH) > 0))
      problems.push('Дэлгэцийн хэмжээг шалгана уу.');
    setErrors(problems);
    if (problems.length) return;
    start(async () => {
      try {
        const detail = await saveHall({
          hall,
          branchId,
          name: name.trim(),
          screenW: Number(screenW),
          screenH: Number(screenH),
          gen: d.gen,
          regenerate: d.regenerate,
          pending: d.pending,
        });
        d.clearPending();
        setSaved(true);
        if (!hall) router.replace(`/admin/halls/${detail.id}`);
        else router.refresh();
      } catch (err) {
        setErrors([messageOf(err)]);
        router.refresh();
      }
    });
  }

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
          <GeneratorFields raw={d.raw} setRaw={d.setRaw} locked={locked} />
          {!d.genValid && (
            <Notice>
              Суудлын тохиргооны утгуудыг шалгана уу. Сүүлийн зөв утгаар харуулж байна.
            </Notice>
          )}
        </section>
      </div>

      <div className="min-w-0 space-y-4">
        <section className="highlight rounded-panel border border-hairline bg-raised p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <PaintToolbar tool={d.tool} setTool={d.setTool} counts={d.counts} />
            <p className="ml-auto text-[13px] text-muted tabular-nums">
              Нийт {d.seats.length} суудал
            </p>
          </div>
          {d.regenerate && (
            <p className="mb-3 rounded-card border border-hue-yellow/30 bg-hue-yellow/10 px-3 py-2 text-[13px] text-body">
              Шинэ зохион байгуулалтын урьдчилсан харагдац. Хадгалахад бүх суудал дахин үүсч, өмнөх
              будалт арилна.
            </p>
          )}
          <div className="overflow-hidden rounded-card border border-hairline bg-canvas p-3">
            <SeatPlan
              seats={d.seats}
              pitchM={d.gen.seatPitchM}
              screenWidthM={sw}
              screenXM={screenX}
              selected={d.selected}
              onPaint={d.paint}
              onPaintRow={d.paintRow}
              ariaLabel="Заалны суудлын зураг"
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            {d.tool === 'view'
              ? 'Суудал дээр дарж хажуугийн зүсэлт, харагдацыг үзнэ.'
              : `“${KIND_LABEL[d.tool]}” сонгосон: суудал дээр дарж эсвэл чирж будна, эгнээний үсэг дээр дарвал эгнээг бүхэлд нь будна.`}
          </p>
        </section>

        <section className="highlight grid gap-4 rounded-panel border border-hairline bg-raised p-4 lg:grid-cols-[minmax(0,1fr)_200px]">
          <div>
            <h2 className="mb-2 text-[15px] font-semibold text-ink">Хажуугийн зүсэлт</h2>
            <div className="rounded-card border border-hairline bg-canvas p-2">
              <SideProfile seats={d.seats} seat={probe} screenHeightM={sh} />
            </div>
          </div>
          <SeatStats seat={sel ? `${sel.rowLabel}${sel.number}` : null} stats={stats} />
        </section>

        {errors.map((e) => (
          <Notice key={e}>{e}</Notice>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={save} disabled={busy || (!!hall && !dirty)}>
            {busy
              ? 'Хадгалж байна…'
              : !hall
                ? 'Заал үүсгэх'
                : d.regenerate
                  ? 'Суудлыг дахин үүсгэх'
                  : 'Хадгалах'}
          </Button>
          {d.pending.size > 0 && (
            <>
              <span className="text-[13px] text-muted tabular-nums">
                {d.pending.size} суудал будагдсан
              </span>
              <Button variant="ghost" size="sm" onClick={d.clearPending}>
                Будалтыг болиулах
              </Button>
            </>
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
