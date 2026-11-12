'use client';

import { clockUb } from '@/lib/format';
import { canUndo, cardFor } from '@/lib/scan/card';
import type { ScanResultCode } from '@/lib/shared';
import { useNow } from './useNow';
import type { RecentScan } from './useRecent';

const DOT: Record<string, string> = {
  admit: 'bg-hue-green',
  neutral: 'bg-muted',
  reject: 'bg-hue-red',
};

const LABEL: Partial<Record<ScanResultCode, string>> = {
  admitted: 'Орсон',
  repeat: 'Давтан',
  undone: 'Буцаасан',
  already_used: 'Ашиглагдсан',
  wrong_branch: 'Салбар',
  wrong_day: 'Өдөр',
  invalid: 'Хүчингүй',
};

/** Last scans on this phone, newest first. An admit still inside its 2 minutes offers Undo. */
export function RecentStrip({
  items,
  undoing,
  onUndo,
}: {
  items: RecentScan[];
  undoing: string | null;
  onUndo: (scanId: string) => void;
}) {
  const now = useNow(
    1000,
    items.some((i) => i.result.undoUntil !== null),
  );
  if (items.length === 0) return null;
  return (
    <ul
      aria-label="Сүүлийн уншилтууд"
      className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-1"
    >
      {items.map(({ result, undone }) => {
        const tone = undone ? 'neutral' : cardFor(result).tone;
        const undo = !undone && canUndo(result, now);
        return (
          <li
            key={result.scanId}
            className="highlight flex h-[60px] shrink-0 items-center gap-2.5 rounded-panel border border-hairline bg-surface/90 pr-1 pl-3 backdrop-blur"
          >
            <span aria-hidden className={`size-2.5 rounded-full ${DOT[tone]}`} />
            <span className="min-w-[2.2ch] text-[22px] leading-none font-semibold text-ink tabular-nums">
              {result.ticket?.seatCode ?? '—'}
            </span>
            <span className="text-[12px] leading-tight text-muted">
              {undone ? 'Буцаасан' : (LABEL[result.result] ?? '')}
              {result.undoUntil && !undone && (
                <>
                  <br />
                  {clockUb(new Date(Date.parse(result.undoUntil) - 120_000))}
                </>
              )}
            </span>
            {undo && (
              <button
                type="button"
                disabled={undoing === result.scanId}
                onClick={() => onUndo(result.scanId)}
                className="focus-ring ml-1 h-11 rounded-card bg-fill px-3 text-[14px] font-semibold text-ink active:bg-white/[0.14] disabled:opacity-60"
              >
                Буцаах
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
