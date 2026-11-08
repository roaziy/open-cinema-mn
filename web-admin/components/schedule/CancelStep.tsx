'use client';

import {
  formatMnt,
  type ShowtimeCancelPreview,
  ShowtimeCancelPreviewSchema,
} from '@open-cinema/shared';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { call, messageOf } from '@/lib/client-api';
import { count } from '@/lib/format';

type State =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; preview: ShowtimeCancelPreview };

/** Loads the API's own cancellation preview; `onReady` tells the drawer whether confirming is allowed. */
export function useCancelPreview(showtimeId: string, active: boolean) {
  const [state, setState] = useState<State>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on retry
  useEffect(() => {
    if (!active) return;
    let live = true;
    setState({ state: 'loading' });
    call<unknown>('GET', `/admin/showtimes/${showtimeId}/cancel-preview`)
      .then((raw) => {
        const parsed = ShowtimeCancelPreviewSchema.safeParse(raw);
        if (!live) return;
        setState(
          parsed.success
            ? { state: 'ready', preview: parsed.data }
            : { state: 'error', message: 'Буцаалтын дүнг уншиж чадсангүй.' },
        );
      })
      .catch((err) => live && setState({ state: 'error', message: messageOf(err) }));
    return () => {
      live = false;
    };
  }, [active, showtimeId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

/** What cancelling does, in numbers, before the admin confirms. */
export function CancelStep({
  movieTitle,
  time,
  hallName,
  preview,
  retry,
}: {
  movieTitle: string;
  time: string;
  hallName: string;
  preview: State;
  retry: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-body">
        <span className="font-medium text-ink">{movieTitle}</span>, {time}, {hallName} сеансыг
        цуцлах уу? Зарагдсан бүх тасалбар хүчингүй болж, төлсөн мөнгийг худалдан авагчид буцаана.
      </p>
      <div className="rounded-panel border border-hairline bg-raised p-4" aria-live="polite">
        {preview.state === 'loading' && (
          <p className="text-sm text-muted">Буцаалтын дүнг бодож байна…</p>
        )}
        {preview.state === 'error' && (
          <div className="space-y-3">
            <Notice>{preview.message}</Notice>
            <Button size="sm" onClick={retry}>
              Дахин оролдох
            </Button>
          </div>
        )}
        {preview.state === 'ready' && <Numbers p={preview.preview} />}
      </div>
      <p className="text-xs text-muted">Энэ үйлдлийг буцаах боломжгүй.</p>
    </div>
  );
}

function Numbers({ p }: { p: ShowtimeCancelPreview }) {
  if (p.paidBookings === 0) {
    return (
      <div className="space-y-1 text-sm text-body">
        <p>Төлөгдсөн захиалга байхгүй тул буцаалт хийгдэхгүй.</p>
        <Extras p={p} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-3 gap-4">
        <Stat label="Захиалга" value={count(p.paidBookings)} />
        <Stat label="Тасалбар" value={count(p.tickets)} />
        <Stat label="Буцаах дүн" value={formatMnt(p.refundAmount)} />
      </dl>
      <Extras p={p} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function Extras({ p }: { p: ShowtimeCancelPreview }) {
  if (p.pendingBookings === 0 && p.activeHolds === 0) return null;
  return (
    <p className="text-[13px] text-muted">
      {p.pendingBookings > 0 && `${count(p.pendingBookings)} төлөгдөөгүй захиалга хүчингүй болно. `}
      {p.activeHolds > 0 && `${count(p.activeHolds)} суудлын хадгалалт чөлөөлөгдөнө.`}
    </p>
  );
}
