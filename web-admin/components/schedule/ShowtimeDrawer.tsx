'use client';

import {
  type AdminMovie,
  type AdminShowtime,
  AdminShowtimeBody,
  formatUbTime,
  SeatMapSchema,
  type ShowtimeCancelResult,
  ubDate,
} from '@open-cinema/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Labeled, Select, TextInput } from '@/components/ui/Inputs';
import { Notice } from '@/components/ui/Notice';
import { call, messageOf } from '@/lib/client-api';
import { count, mnt, ubInstant } from '@/lib/format';
import { refundPreview } from './refund';

export type HallOption = { id: string; name: string; branchName: string };

export type DrawerTarget =
  | { mode: 'create'; hallId?: string; date: string; time?: string }
  | { mode: 'edit'; showtime: AdminShowtime };

type Preview =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; tickets: number; amount: number };

const FORMATS = ['2D', '3D', 'IMAX'] as const;

/** Create / edit a showing, and cancel it with the refund shown first. Remount per target. */
export function ShowtimeDrawer({
  target,
  movies,
  halls,
  nowMs,
  onClose,
}: {
  target: DrawerTarget | null;
  movies: AdminMovie[];
  halls: HallOption[];
  nowMs: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const editing = target?.mode === 'edit' ? target.showtime : null;
  const [movieId, setMovieId] = useState(
    editing?.movieId ?? movies.find((m) => m.status === 'now')?.id ?? movies[0]?.id ?? '',
  );
  const [hallId, setHallId] = useState(
    editing?.hallId ??
      (target?.mode === 'create' ? target.hallId : undefined) ??
      halls[0]?.id ??
      '',
  );
  const [date, setDate] = useState(
    editing ? ubDate(editing.startsAt) : target?.mode === 'create' ? target.date : '',
  );
  const [time, setTime] = useState(
    editing
      ? formatUbTime(editing.startsAt)
      : target?.mode === 'create'
        ? (target.time ?? '18:00')
        : '',
  );
  const [format, setFormat] = useState<(typeof FORMATS)[number]>(editing?.format ?? '2D');
  const [std, setStd] = useState(String(editing?.priceStandard ?? 15000));
  const [prem, setPrem] = useState(String(editing?.pricePremium ?? 22000));
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'cancel' | 'done'>('form');
  const [preview, setPreview] = useState<Preview>({ state: 'loading' });
  const [result, setResult] = useState<ShowtimeCancelResult | null>(null);
  const [pending, start] = useTransition();

  const movie = movies.find((m) => m.id === movieId);
  const isCancelled = editing?.status === 'cancelled';
  const started = editing ? new Date(editing.startsAt).getTime() <= nowMs : false;
  const canCancel = !!editing && !isCancelled && !started;

  useEffect(() => {
    if (step !== 'cancel' || !editing) return;
    let live = true;
    setPreview({ state: 'loading' });
    call<unknown>('GET', `/showtimes/${editing.id}`)
      .then((raw) => {
        const parsed = SeatMapSchema.safeParse(raw);
        if (!live) return;
        setPreview(
          parsed.success ? { state: 'ready', ...refundPreview(parsed.data) } : { state: 'error' },
        );
      })
      .catch(() => live && setPreview({ state: 'error' }));
    return () => {
      live = false;
    };
  }, [step, editing]);

  function save() {
    const body = {
      movieId,
      hallId,
      startsAt: date && time ? ubInstant(date, time) : '',
      format,
      priceStandard: Number(std),
      pricePremium: Number(prem),
    };
    const parsed = AdminShowtimeBody.safeParse(body);
    if (!parsed.success) {
      setError('Кино, заал, цаг, үнээ шалгана уу.');
      return;
    }
    setError(null);
    start(async () => {
      try {
        if (editing) await call('PATCH', `/admin/showtimes/${editing.id}`, parsed.data);
        else await call('POST', '/admin/showtimes', parsed.data);
        onClose();
        router.refresh();
      } catch (err) {
        setError(messageOf(err));
      }
    });
  }

  function cancel() {
    if (!editing) return;
    start(async () => {
      try {
        const r = await call<ShowtimeCancelResult>('POST', `/admin/showtimes/${editing.id}/cancel`);
        setResult(r);
        setStep('done');
        router.refresh();
      } catch (err) {
        setStep('form');
        setError(messageOf(err));
      }
    });
  }

  const title =
    step === 'cancel'
      ? 'Сеанс цуцлах'
      : step === 'done'
        ? 'Сеанс цуцлагдлаа'
        : editing
          ? 'Сеанс засах'
          : 'Шинэ сеанс';
  const readOnly = isCancelled || started;

  return (
    <Drawer
      open={target !== null}
      onClose={onClose}
      title={title}
      subtitle={editing ? `${editing.movieTitle} · ${editing.hallName}` : undefined}
      footer={
        step === 'form' ? (
          <>
            {canCancel && (
              <Button variant="danger" className="mr-auto" onClick={() => setStep('cancel')}>
                Сеанс цуцлах
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Хаах
            </Button>
            {!(isCancelled || started) && (
              <Button type="submit" form="showtime-form" variant="primary" disabled={pending}>
                {pending ? 'Хадгалж байна…' : editing ? 'Хадгалах' : 'Сеанс нэмэх'}
              </Button>
            )}
          </>
        ) : step === 'cancel' ? (
          <>
            <Button variant="ghost" onClick={() => setStep('form')} disabled={pending}>
              Буцах
            </Button>
            <Button
              variant="danger"
              onClick={cancel}
              disabled={pending || preview.state !== 'ready'}
            >
              {pending ? 'Цуцалж байна…' : 'Цуцлаад буцаалт хийх'}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Ойлголоо
          </Button>
        )
      }
    >
      {step === 'form' && (
        <form
          id="showtime-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!readOnly) save();
          }}
        >
          {isCancelled && <Notice>Энэ сеанс цуцлагдсан тул засах боломжгүй.</Notice>}
          {started && !isCancelled && (
            <p className="rounded-card border border-hue-yellow/30 bg-hue-yellow/10 px-3 py-2 text-[13px] text-body">
              Сеанс эхэлсэн тул засах, цуцлах боломжгүй.
            </p>
          )}
          {editing && (
            <div className="flex items-center gap-3 rounded-card border border-hairline bg-raised px-3.5 py-2.5 text-[13px]">
              <span className="text-muted">Зарагдсан</span>
              <span className="font-medium text-ink tabular-nums">
                {editing.sold} / {editing.capacity}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
                <div
                  className="h-full rounded-full bg-hue-green"
                  style={{
                    width: `${editing.capacity ? Math.round((editing.sold / editing.capacity) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
          <fieldset disabled={readOnly} className="space-y-4 disabled:opacity-60">
            <Labeled
              label="Кино"
              htmlFor="t-movie"
              hint={movie ? `Үргэлжлэх хугацаа ${movie.durationMin} мин` : undefined}
            >
              <Select
                id="t-movie"
                data-autofocus
                value={movieId}
                onChange={(e) => setMovieId(e.target.value)}
              >
                {movies
                  .filter((m) => m.status !== 'archived' || m.id === movieId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
              </Select>
            </Labeled>
            <Labeled label="Заал" htmlFor="t-hall">
              <Select id="t-hall" value={hallId} onChange={(e) => setHallId(e.target.value)}>
                {halls.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.branchName} · {h.name}
                  </option>
                ))}
              </Select>
            </Labeled>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Огноо" htmlFor="t-date">
                <TextInput
                  id="t-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Labeled>
              <Labeled label="Эхлэх цаг" htmlFor="t-time">
                <TextInput
                  id="t-time"
                  type="time"
                  step={300}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </Labeled>
            </div>
            <Labeled label="Формат" htmlFor="t-format">
              <Select
                id="t-format"
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Labeled>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Энгийн суудлын үнэ (₮)" htmlFor="t-std">
                <TextInput
                  id="t-std"
                  type="number"
                  inputMode="numeric"
                  step={500}
                  min={0}
                  value={std}
                  onChange={(e) => setStd(e.target.value)}
                />
              </Labeled>
              <Labeled label="Премиум суудлын үнэ (₮)" htmlFor="t-prem">
                <TextInput
                  id="t-prem"
                  type="number"
                  inputMode="numeric"
                  step={500}
                  min={0}
                  value={prem}
                  onChange={(e) => setPrem(e.target.value)}
                />
              </Labeled>
            </div>
            {editing && editing.sold > 0 && !readOnly && (
              <p className="text-xs text-muted">
                Тасалбар зарагдсан сеансын цаг, заал, киног өөрчлөх боломжгүй. Үнийг л өөрчилж
                болно, өмнө төлсөн захиалгад нөлөөлөхгүй.
              </p>
            )}
          </fieldset>
          {error && <Notice>{error}</Notice>}
        </form>
      )}

      {step === 'cancel' && editing && (
        <div className="space-y-4">
          <p className="text-[15px] text-body">
            <span className="font-medium text-ink">{editing.movieTitle}</span>,{' '}
            {formatUbTime(editing.startsAt)}, {editing.hallName} сеансыг цуцлах уу? Зарагдсан бүх
            тасалбар хүчингүй болж, мөнгийг худалдан авагчид буцаана.
          </p>
          <div className="rounded-panel border border-hairline bg-raised p-4" aria-live="polite">
            {preview.state === 'loading' && (
              <p className="text-sm text-muted">Буцаалтын дүнг бодож байна…</p>
            )}
            {preview.state === 'error' && (
              <Notice>Буцаалтын дүнг тооцоолж чадсангүй. Дахин нээж оролдоно уу.</Notice>
            )}
            {preview.state === 'ready' &&
              (preview.tickets === 0 ? (
                <p className="text-sm text-body">Тасалбар зарагдаагүй тул буцаалт байхгүй.</p>
              ) : (
                <dl className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-xs text-muted">Буцаах тасалбар</dt>
                    <dd className="mt-0.5 text-2xl font-semibold text-ink tabular-nums">
                      {count(preview.tickets)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Буцаах дүн</dt>
                    <dd className="mt-0.5 text-2xl font-semibold text-ink tabular-nums">
                      {mnt(preview.amount)}
                    </dd>
                  </div>
                </dl>
              ))}
          </div>
          <p className="text-xs text-muted">Энэ үйлдлийг буцаах боломжгүй.</p>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-3 text-[15px] text-body">
          <p>Сеанс цуцлагдлаа.</p>
          <p className="tabular-nums">
            {result.cancelledBookings === 0
              ? 'Буцаалт хийгдсэн захиалга байхгүй.'
              : `${count(result.cancelledBookings)} захиалга, ${count(result.cancelledTickets)} тасалбар цуцлагдаж, буцаалт хийгдэж байна.`}
          </p>
        </div>
      )}
    </Drawer>
  );
}
