'use client';

import type { ScanResult } from '@open-cinema/shared';
import { Poster } from '@/components/ui/Poster';
import { clockUb } from '@/lib/format';
import { canUndo, cardFor, type Tone, undoSecondsLeft } from '@/lib/scan/card';
import { avoidOrange } from '@/lib/tone';
import { useNow } from './useNow';

const SURFACE: Record<Tone, string> = {
  admit: 'bg-hue-green text-on-green',
  reject: 'bg-hue-red text-on-red',
  neutral: 'border-t border-hairline bg-raised text-ink',
};

const SECONDARY: Record<Tone, string> = {
  admit: 'bg-black/15 text-on-green active:bg-black/25',
  reject: 'bg-black/15 text-on-red active:bg-black/25',
  neutral: 'bg-fill text-ink active:bg-white/[0.14]',
};

const PRIMARY: Record<Tone, string> = {
  admit: 'bg-on-green text-white',
  reject: 'bg-on-red text-white',
  neutral: 'bg-action text-white',
};

const BTN =
  'focus-ring flex h-16 items-center justify-center rounded-panel px-5 text-[18px] font-semibold disabled:opacity-60';

/** The answer, over the live camera. Colour says what to do; the seat code is read from arm's length. */
export function ResultCard({
  result,
  undoing,
  onClose,
  onUndo,
}: {
  result: ScanResult;
  undoing: boolean;
  onClose: () => void;
  onUndo: (scanId: string) => void;
}) {
  const info = cardFor(result);
  const t = result.ticket;
  const now = useNow(1000, result.result === 'admitted');
  const left = undoSecondsLeft(result, now);
  const showUndo = canUndo(result, now);
  const reject = info.tone === 'reject';

  return (
    <section
      aria-label={info.title}
      className={`animate-rise absolute inset-x-0 bottom-0 z-20 flex flex-col gap-4 rounded-t-rail px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] ${SURFACE[info.tone]}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[22px] font-semibold leading-tight">{info.title}</h2>
        {t && t.partySize > 1 && (
          <p className="shrink-0 text-[17px] font-semibold tabular-nums opacity-80">
            {t.partyIndex}/{t.partySize} билет
          </p>
        )}
      </div>

      {t && (
        <p className="text-[132px] font-semibold leading-[0.85] tracking-[-0.03em] tabular-nums">
          {t.seatCode}
        </p>
      )}

      {t && (
        <div className="flex items-center gap-3.5">
          <Poster
            src={t.posterUrl}
            title={t.movieTitle}
            tone={avoidOrange(t.tone)}
            className="h-[84px] w-14 rounded-card"
          />
          <div className="min-w-0">
            <p className="truncate text-[19px] font-semibold leading-tight">{t.movieTitle}</p>
            <p className="mt-0.5 text-[16px] opacity-80">
              {t.hallName} · {clockUb(t.startsAt)}
            </p>
          </div>
        </div>
      )}

      {info.detail && (
        <p className={`${reject ? 'text-[19px] font-semibold' : 'text-[17px] opacity-85'}`}>
          {info.detail}
        </p>
      )}

      <div className="mt-1 flex gap-3">
        {showUndo ? (
          <button
            type="button"
            disabled={undoing}
            onClick={() => onUndo(result.scanId)}
            className={`${BTN} shrink-0 ${SECONDARY[info.tone]}`}
          >
            Буцаах
            <span className="ml-2 text-[15px] tabular-nums opacity-70">
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
            </span>
          </button>
        ) : null}
        <button type="button" onClick={onClose} className={`${BTN} flex-1 ${PRIMARY[info.tone]}`}>
          {reject ? 'Хаах' : 'Дараагийнх'}
        </button>
      </div>
    </section>
  );
}
