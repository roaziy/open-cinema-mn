import { EYE_HEIGHT_M, SCREEN_BOTTOM_M } from '@/lib/shared';

type S = { rowLabel: string; x_m: number; y_m: number; z_m: number };

const W = 520;
const H = 190;

/**
 * Side section through the chosen seat's column: stepped floor, one head per row, the screen on
 * the left and the sight lines from the chosen seat to the screen's bottom, centre and top.
 */
export function SideProfile({
  seats,
  seat,
  screenHeightM,
}: {
  seats: S[];
  seat: S | null;
  screenHeightM: number;
}) {
  if (seats.length === 0) return null;
  const rows = [...new Set(seats.map((s) => s.rowLabel))];
  const col = seat?.x_m ?? 0;
  const line = rows
    .map((r) => {
      const inRow = seats.filter((s) => s.rowLabel === r);
      return inRow.reduce((best, s) =>
        Math.abs(s.x_m - col) < Math.abs(best.x_m - col) ? s : best,
      );
    })
    .sort((a, b) => a.y_m - b.y_m);

  const maxY = Math.max(...line.map((s) => s.y_m)) + 0.8;
  const maxZ = Math.max(
    ...line.map((s) => s.z_m + EYE_HEIGHT_M + 0.3),
    SCREEN_BOTTOM_M + screenHeightM + 0.3,
  );
  const padL = 24;
  const padB = 22;
  const scale = Math.min((W - padL - 12) / maxY, (H - padB - 10) / maxZ);
  const x = (y: number) => padL + y * scale;
  const y = (z: number) => H - padB - z * scale;

  const floor = line.map((s) => `${x(s.y_m).toFixed(1)},${y(s.z_m).toFixed(1)}`).join(' ');
  const eye = seat ? { y: seat.y_m, z: seat.z_m + EYE_HEIGHT_M } : null;
  const targets = [
    SCREEN_BOTTOM_M,
    SCREEN_BOTTOM_M + screenHeightM / 2,
    SCREEN_BOTTOM_M + screenHeightM,
  ];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Хажуугаас харсан зүсэлт"
      className="block h-auto w-full"
    >
      <rect
        x={x(0) - 4}
        y={y(SCREEN_BOTTOM_M + screenHeightM)}
        width={4}
        height={screenHeightM * scale}
        rx={2}
        className="fill-ink"
      />
      <polyline points={floor} fill="none" className="stroke-white/20" strokeWidth={1.5} />
      <line x1={x(0)} x2={x(maxY)} y1={y(0)} y2={y(0)} className="stroke-hairline" />
      {eye &&
        targets.map((t, i) => (
          <line
            key={t}
            x1={x(eye.y)}
            y1={y(eye.z)}
            x2={x(0)}
            y2={y(t)}
            className="stroke-action"
            strokeWidth={i === 1 ? 1.5 : 1}
            strokeDasharray={i === 1 ? undefined : '3 3'}
            opacity={i === 1 ? 0.9 : 0.55}
          />
        ))}
      {line.map((s) => {
        const on = seat && s.rowLabel === seat.rowLabel;
        return (
          <g key={s.rowLabel}>
            <circle
              cx={x(s.y_m)}
              cy={y(s.z_m + EYE_HEIGHT_M)}
              r={on ? 4.5 : 3}
              className={on ? 'fill-action' : 'fill-muted'}
            />
            <line
              x1={x(s.y_m)}
              x2={x(s.y_m)}
              y1={y(s.z_m + EYE_HEIGHT_M)}
              y2={y(s.z_m)}
              className="stroke-white/10"
            />
            {(on || line.length <= 14) && (
              <text
                x={x(s.y_m)}
                y={H - 6}
                textAnchor="middle"
                fontSize="10"
                className={on ? 'fill-ink' : 'fill-muted'}
              >
                {s.rowLabel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
