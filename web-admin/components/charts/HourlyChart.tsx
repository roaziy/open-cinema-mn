import { formatMnt } from '@open-cinema/shared';
import { compact, count } from '@/lib/format';

type Hour = { hour: number; revenue: number; tickets: number };

const W = 720;
const H = 208;
const PAD = { l: 52, r: 8, t: 12, b: 24 };

/** A "nice" axis ceiling: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/** Revenue per Ulaanbaatar hour. The current hour is drawn at full strength, the rest muted. */
export function HourlyChart({ hours, nowHour }: { hours: Hour[]; nowHour: number }) {
  const withSales = hours.filter((h) => h.revenue > 0 || h.tickets > 0).map((h) => h.hour);
  const from = Math.min(9, ...withSales);
  const to = Math.max(23, ...withSales);
  const shown = hours.filter((h) => h.hour >= from && h.hour <= to);
  const max = niceMax(Math.max(...shown.map((h) => h.revenue), 0));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const slot = iw / shown.length;
  const barW = Math.min(slot - 6, 22);
  const empty = shown.every((h) => h.revenue === 0);
  const ticks = empty ? [0] : [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Цаг тутмын борлуулалт"
      className="block h-auto w-full"
    >
      {ticks.map((t) => {
        const y = PAD.t + ih - t * ih;
        return (
          <g key={t}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y}
              y2={y}
              className="stroke-hairline"
              strokeDasharray={t === 0 ? undefined : '2 4'}
            />
            <text x={PAD.l - 8} y={y + 4} textAnchor="end" fontSize="11" className="fill-muted">
              {compact(max * t)}
            </text>
          </g>
        );
      })}
      {shown.map((h, i) => {
        const bh = max > 0 ? (h.revenue / max) * ih : 0;
        const x = PAD.l + i * slot + (slot - barW) / 2;
        const live = h.hour === nowHour;
        return (
          <g key={h.hour}>
            <rect
              x={x}
              y={PAD.t + ih - Math.max(bh, h.revenue > 0 ? 2 : 0)}
              width={barW}
              height={Math.max(bh, h.revenue > 0 ? 2 : 0)}
              rx={4}
              className="fill-hue-green"
              opacity={live ? 1 : 0.55}
            >
              <title>{`${String(h.hour).padStart(2, '0')}:00 · ${formatMnt(h.revenue)} · ${count(h.tickets)} тасалбар`}</title>
            </rect>
            {(h.hour % 3 === 0 || live) && (
              <text
                x={x + barW / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize="11"
                className={live ? 'fill-ink' : 'fill-muted'}
              >
                {String(h.hour).padStart(2, '0')}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
