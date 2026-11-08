import Link from 'next/link';
import { Poster } from '@/components/ui/Poster';
import { clockUb, count } from '@/lib/format';
import type { TodayShowtime } from '@/lib/schemas';
import { avoidOrange } from '@/lib/tone';

const MIN = 60_000;
/** Doors are busy from half an hour before the start until twenty minutes after it. */
const BEFORE = 30 * MIN;
const AFTER = 20 * MIN;

type Phase = 'past' | 'live' | 'later';

function phaseOf(startsAt: string, now: number): Phase {
  const t = Date.parse(startsAt);
  if (now > t + AFTER) return 'past';
  return now >= t - BEFORE ? 'live' : 'later';
}

/** Today's showings at this branch with door progress; the ones being let in now are marked. */
export function TodayList({
  rows,
  now,
  scansHref,
}: {
  rows: TodayShowtime[];
  now: number;
  /** Where a row's "scans" link leads (admin only). */
  scansHref?: (row: TodayShowtime) => string;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const phase = phaseOf(r.startsAt, now);
        const ratio = r.sold > 0 ? Math.min(1, r.admitted / r.sold) : 0;
        return (
          <li
            key={r.id}
            data-phase={phase}
            className={`highlight relative flex items-stretch gap-3 overflow-hidden rounded-panel border bg-raised p-2.5 pl-3 ${phase === 'live' ? 'border-action/60' : 'border-hairline'} ${phase === 'past' ? 'opacity-55' : ''}`}
          >
            {phase === 'live' && (
              <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-action" />
            )}
            <Poster
              src={r.posterUrl}
              title={r.movieTitle}
              tone={avoidOrange(r.tone)}
              className="h-[72px] w-12"
            />
            <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
              <div className="flex items-baseline gap-2">
                <p className="text-[22px] leading-none font-semibold text-ink tabular-nums">
                  {clockUb(r.startsAt)}
                </p>
                <p className="truncate text-[13px] text-muted">{r.hallName}</p>
              </div>
              <p className="truncate text-[15px] font-medium text-ink">{r.movieTitle}</p>
              <div className="flex items-center gap-2.5">
                <div
                  role="progressbar"
                  aria-label="Орсон тасалбар"
                  aria-valuemin={0}
                  aria-valuemax={r.sold}
                  aria-valuenow={r.admitted}
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill"
                >
                  <div
                    className="h-full rounded-full bg-hue-green transition-[width] duration-500"
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
                <p className="shrink-0 text-[13px] text-body tabular-nums">
                  <span className="font-semibold text-ink">{count(r.admitted)}</span>
                  {' / '}
                  {count(r.sold)}
                </p>
                {scansHref && (
                  <Link
                    href={scansHref(r)}
                    className="focus-ring shrink-0 rounded-tile px-2 py-1 text-[13px] font-medium text-body hover:bg-white/[0.06] hover:text-ink"
                  >
                    Шалгалт
                  </Link>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
