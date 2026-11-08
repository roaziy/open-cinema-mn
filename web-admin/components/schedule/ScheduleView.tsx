'use client';

import type { AdminMovie, AdminShowtime } from '@open-cinema/shared';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { count, minutesIntoDay } from '@/lib/format';
import { HUES, type HueKey } from '@/lib/hues';
import { clickToStart, hourTicks, nowOffset, place, rangeFor } from '@/lib/timeline';
import { type DrawerTarget, type HallOption, ShowtimeDrawer } from './ShowtimeDrawer';

export type HallRow = HallOption & { branchId: string; hue: HueKey };

const LABEL_W = 168;
const ROW_H = 68;
const MIN_TRACK = 920;

export function ScheduleView({
  date,
  isToday,
  nowMs,
  halls,
  showtimes,
  movies,
  truncated,
}: {
  date: string;
  isToday: boolean;
  nowMs: number;
  halls: HallRow[];
  showtimes: AdminShowtime[];
  movies: AdminMovie[];
  truncated: boolean;
}) {
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [isToday]);

  const tone = useMemo(() => new Map(movies.map((m) => [m.id, m.tone])), [movies]);
  const items = useMemo(
    () =>
      showtimes.map((s) => ({
        s,
        startMin: minutesIntoDay(date, s.startsAt),
        endMin: minutesIntoDay(date, s.endsAt),
      })),
    [showtimes, date],
  );
  const range = useMemo(() => rangeFor(items), [items]);
  const ticks = hourTicks(range);
  const nowMin = isToday ? minutesIntoDay(date, new Date(now)) : -1;
  const nowLeft = isToday ? nowOffset(nowMin, range) : null;
  const live = items.filter((i) => i.s.status === 'scheduled');
  const sold = live.reduce((n, i) => n + i.s.sold, 0);
  const capacity = live.reduce((n, i) => n + i.s.capacity, 0);

  const byBranch = useMemo(() => {
    const map = new Map<string, { name: string; hue: HueKey; halls: HallRow[] }>();
    for (const h of halls) {
      const g = map.get(h.branchId) ?? { name: h.branchName, hue: h.hue, halls: [] };
      g.halls.push(h);
      map.set(h.branchId, g);
    }
    return [...map.values()];
  }, [halls]);

  function createAt(hallId: string, e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = clickToStart(date, (e.clientX - rect.left) / rect.width, range);
    setTarget({ mode: 'create', hallId, ...start });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted tabular-nums">
          <span className="font-medium text-ink">{count(live.length)}</span> сеанс ·{' '}
          <span className="font-medium text-ink">{count(sold)}</span> / {count(capacity)} суудал
          зарагдсан
        </p>
        <Button
          variant="primary"
          onClick={() => setTarget({ mode: 'create', date })}
          disabled={halls.length === 0 || movies.length === 0}
        >
          <Plus size={16} aria-hidden />
          Шинэ сеанс
        </Button>
      </div>
      {truncated && (
        <p className="mb-3 rounded-card border border-hue-yellow/30 bg-hue-yellow/10 px-3 py-2 text-[13px] text-body">
          Сеанс хэт олон тул зарим нь харагдахгүй байна. Салбараар шүүнэ үү.
        </p>
      )}

      {halls.length === 0 ? (
        <Empty title="Заал алга">Сеанс товлохын өмнө салбар, заал нэмнэ үү.</Empty>
      ) : (
        <div className="highlight overflow-x-auto rounded-panel border border-hairline bg-canvas">
          <div style={{ minWidth: LABEL_W + MIN_TRACK }}>
            <div className="sticky top-0 z-20 flex border-b border-hairline bg-canvas">
              <div style={{ width: LABEL_W }} className="shrink-0 px-4 py-2.5 text-xs text-muted">
                Заал
              </div>
              <div className="relative mr-6 h-9 flex-1">
                {ticks.map((t) => (
                  <span
                    key={t.label}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs text-muted tabular-nums"
                    style={{ left: `${t.left}%` }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative">
              {nowLeft !== null && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 z-10"
                  style={{ left: LABEL_W, right: 24 }}
                >
                  <div
                    className="absolute inset-y-0 w-px bg-action"
                    style={{ left: `${nowLeft}%` }}
                  >
                    <span className="absolute -top-px left-1/2 -translate-x-1/2 rounded-b-[6px] bg-action px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
                      {fmt(nowMin)}
                    </span>
                  </div>
                </div>
              )}
              {byBranch.map((g) => (
                <section key={g.name} aria-label={g.name}>
                  <div className="flex items-center gap-2 border-b border-hairline bg-surface px-4 py-1.5 text-xs font-medium text-body">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ background: HUES[g.hue] }}
                    />
                    {g.name}
                  </div>
                  {g.halls.map((h) => (
                    <div
                      key={h.id}
                      className="flex border-b border-hairline last:border-b-0"
                      style={{ height: ROW_H }}
                    >
                      <div
                        style={{ width: LABEL_W }}
                        className="flex shrink-0 items-center px-4 text-sm font-medium text-ink"
                      >
                        <span className="truncate">{h.name}</span>
                      </div>
                      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the "Шинэ сеанс" button is the keyboard path */}
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: click-to-create shortcut on the empty track */}
                      <div
                        className="relative flex-1 cursor-copy"
                        onClick={(e) => createAt(h.id, e)}
                      >
                        {ticks.map((t) => (
                          <span
                            key={t.label}
                            aria-hidden
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.04]"
                            style={{ left: `${t.left}%` }}
                          />
                        ))}
                        {items
                          .filter((i) => i.s.hallId === h.id)
                          .map(({ s, startMin, endMin }) => {
                            const { left, width } = place({ startMin, endMin }, range);
                            const color = tone.get(s.movieId) ?? '#2E6BF0';
                            const cancelled = s.status === 'cancelled';
                            const ended = isToday && endMin <= nowMin;
                            const ratio = s.capacity ? s.sold / s.capacity : 0;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setTarget({ mode: 'edit', showtime: s })}
                                aria-label={chipLabel(s, fmt(startMin))}
                                className={`focus-ring absolute inset-y-2 overflow-hidden rounded-card border text-left transition-[filter,border-color] hover:brightness-125 ${
                                  cancelled ? 'border-dashed border-white/15' : 'border-white/10'
                                } ${ended || cancelled ? 'opacity-50' : ''}`}
                                style={{
                                  left: `${left}%`,
                                  width: `${width}%`,
                                  background: cancelled
                                    ? 'repeating-linear-gradient(135deg, rgb(255 255 255 / 0.04) 0 6px, transparent 6px 12px)'
                                    : `${color}2e`,
                                }}
                              >
                                <span
                                  aria-hidden
                                  className="absolute inset-y-0 left-0 w-1"
                                  style={{ background: color }}
                                />
                                <span className="flex h-full flex-col justify-center gap-0.5 pl-3 pr-2">
                                  <span className="truncate text-[13px] font-medium leading-tight text-ink">
                                    {s.movieTitle}
                                  </span>
                                  <span className="truncate text-xs leading-tight text-body tabular-nums">
                                    {cancelled ? (
                                      'Цуцлагдсан'
                                    ) : (
                                      <>
                                        {fmt(startMin)} · {s.sold}/{s.capacity}
                                        {s.format === '2D' ? '' : ` · ${s.format}`}
                                      </>
                                    )}
                                  </span>
                                </span>
                                {!cancelled && (
                                  <span
                                    aria-hidden
                                    className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-white/30"
                                    style={{ transform: `scaleX(${ratio})` }}
                                  />
                                )}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
      <ShowtimeDrawer
        key={
          target
            ? target.mode === 'edit'
              ? target.showtime.id
              : `new-${target.hallId}-${target.time}`
            : 'closed'
        }
        target={target}
        movies={movies}
        halls={halls}
        nowMs={now}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

function fmt(min: number): string {
  const h = Math.floor(min / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Everything a sighted user reads off the chip, in one phrase. */
function chipLabel(s: AdminShowtime, time: string): string {
  const parts = [s.movieTitle, time, s.format, s.hallName, `${s.sold}/${s.capacity} суудал`];
  if (s.status === 'cancelled') parts.push('цуцлагдсан');
  return parts.join(', ');
}
