'use client';

import {
  type AdminMovie,
  type AdminShowtime,
  AdminShowtimeBody,
  formatMnt,
  formatUbTime,
  type ShowtimeCancelResult,
} from '@open-cinema/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Notice } from '@/components/ui/Notice';
import { call, messageOf } from '@/lib/client-api';
import { count } from '@/lib/format';
import { CancelStep, useCancelPreview } from './CancelStep';
import { ShowtimeFields, useShowtimeDraft } from './ShowtimeFields';

export type HallOption = { id: string; name: string; branchName: string };

export type DrawerTarget =
  | { mode: 'create'; hallId?: string; date: string; time?: string }
  | { mode: 'edit'; showtime: AdminShowtime };

type Step = 'form' | 'cancel' | 'done';

/** Create / edit a showing, and cancel it with the real refund shown first. Remount per target. */
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
  const draft = useShowtimeDraft(target, movies, halls);
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShowtimeCancelResult | null>(null);
  const [pending, start] = useTransition();

  const isCancelled = editing?.status === 'cancelled';
  const started = editing ? new Date(editing.startsAt).getTime() <= nowMs : false;
  const over = isCancelled || started;
  const canCancel = !!editing && !over;
  const preview = useCancelPreview(editing?.id ?? '', step === 'cancel' && !!editing);

  function save() {
    const parsed = AdminShowtimeBody.safeParse(draft.values);
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
        setResult(
          await call<ShowtimeCancelResult>('POST', `/admin/showtimes/${editing.id}/cancel`),
        );
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

  return (
    <Drawer
      open={target !== null}
      onClose={onClose}
      step={step}
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
            {!over && (
              <Button type="submit" form="showtime-form" variant="primary" disabled={pending}>
                {pending ? 'Хадгалж байна…' : editing ? 'Хадгалах' : 'Сеанс нэмэх'}
              </Button>
            )}
          </>
        ) : step === 'cancel' ? (
          <>
            <Button
              variant="ghost"
              data-step-focus
              onClick={() => setStep('form')}
              disabled={pending}
            >
              Буцах
            </Button>
            <Button
              variant="danger"
              onClick={cancel}
              disabled={pending || preview.state.state !== 'ready'}
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
            if (!over) save();
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
          <ShowtimeFields
            f={draft.fields}
            movies={movies}
            halls={halls}
            editing={editing}
            structureLocked={over || (editing?.sold ?? 0) > 0}
            pricesLocked={over}
          />
          {error && <Notice>{error}</Notice>}
        </form>
      )}

      {step === 'cancel' && editing && (
        <CancelStep
          movieTitle={editing.movieTitle}
          time={formatUbTime(editing.startsAt)}
          hallName={editing.hallName}
          preview={preview.state}
          retry={preview.retry}
        />
      )}

      {step === 'done' && result && (
        <div className="space-y-3 text-[15px] text-body">
          <p>Сеанс цуцлагдлаа.</p>
          <p className="tabular-nums">
            {result.cancelledBookings === 0
              ? 'Буцаалт хийгдсэн захиалга байхгүй.'
              : `${count(result.cancelledBookings)} захиалга, ${count(result.cancelledTickets)} тасалбар цуцлагдлаа. ${formatMnt(result.refundAmount)} буцаагдаж байна.`}
          </p>
        </div>
      )}
    </Drawer>
  );
}
