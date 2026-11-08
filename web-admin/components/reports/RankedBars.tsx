import { count, mnt, pct } from '@/lib/format';
import { HUES, type HueKey } from '@/lib/hues';

export type RankedRow = {
  id: string;
  label: string;
  sub?: string;
  hue: HueKey;
  revenue: number;
  tickets: number;
  occupancy: number;
};

/** Rows ranked by revenue; the bar is revenue against the best row, occupancy sits at the right. */
export function RankedBars({ rows }: { rows: RankedRow[] }) {
  const max = Math.max(...rows.map((r) => r.revenue), 1);
  return (
    <ul className="divide-y divide-hairline">
      {rows.map((r) => (
        <li
          key={r.id}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,1fr)_96px_72px]"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">
              {r.label}
              {r.sub && <span className="font-normal text-muted"> · {r.sub}</span>}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fill">
              <div
                className="h-full rounded-full"
                style={{ width: `${(r.revenue / max) * 100}%`, background: HUES[r.hue] }}
              />
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-ink tabular-nums">{mnt(r.revenue)}</p>
            <p className="text-xs text-muted tabular-nums">{count(r.tickets)} тасалбар</p>
          </div>
          <p className="hidden text-right text-sm text-body tabular-nums sm:block">
            {pct(r.occupancy)}
          </p>
        </li>
      ))}
    </ul>
  );
}
