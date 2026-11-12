import { compact, dayMonth } from '@/lib/format';
import { formatMnt } from '@/lib/shared';
import { niceMax } from './HourlyChart';

type Day = { date: string; revenue: number; tickets: number };

const W = 760;
const H = 220;
const PAD = { l: 52, r: 8, t: 12, b: 28 };

/** Revenue per day. Labels thin out on long ranges so they never collide. */
export function DayBars({ days }: { days: Day[] }) {
  const max = niceMax(Math.max(...days.map((d) => d.revenue), 0));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const slot = iw / Math.max(days.length, 1);
  const barW = Math.max(Math.min(slot - 4, 28), 2);
  const every = Math.max(1, Math.ceil(days.length / 12));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Өдөр тутмын борлуулалт"
      className="block h-auto w-full"
    >
      {[0, 0.5, 1].map((t) => {
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
      {days.map((d, i) => {
        const h = max > 0 ? (d.revenue / max) * ih : 0;
        const x = PAD.l + i * slot + (slot - barW) / 2;
        const bh = Math.max(h, d.revenue > 0 ? 2 : 0);
        return (
          <g key={d.date}>
            <rect
              x={x}
              y={PAD.t + ih - bh}
              width={barW}
              height={bh}
              rx={Math.min(4, barW / 2)}
              className="fill-hue-green"
              opacity={0.85}
            >
              <title>{`${dayMonth(d.date)} · ${formatMnt(d.revenue)} · ${d.tickets} тасалбар`}</title>
            </rect>
            {i % every === 0 && (
              <text
                x={x + barW / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize="11"
                className="fill-muted"
              >
                {d.date.slice(8)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
