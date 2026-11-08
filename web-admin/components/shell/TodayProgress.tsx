import { HUES } from '@/lib/hues';

/** How full today's rooms are: sold seats over capacity. */
export function TodayProgress({ sold, capacity }: { sold: number; capacity: number }) {
  const pct = capacity > 0 ? Math.min(100, Math.round((sold / capacity) * 100)) : 0;
  return (
    <div className="highlight rounded-card border border-hairline bg-fill p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-medium text-ink">Өнөөдрийн дүүргэлт</p>
        <p className="text-[13px] font-semibold text-ink tabular-nums">{pct}%</p>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Өнөөдрийн дүүргэлт"
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: HUES.green }}
        />
      </div>
      <p className="mt-2 text-xs text-muted tabular-nums">
        {capacity > 0 ? `${sold} / ${capacity} суудал` : 'Өнөөдөр сеанс алга'}
      </p>
    </div>
  );
}
