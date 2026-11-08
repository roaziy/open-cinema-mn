import type { SeatViewLabel } from '@open-cinema/shared';
import { VIEW_LABEL } from './kinds';

type Stats = { distanceM: number; viewDeg: number; offCenterDeg: number; label: SeatViewLabel };

/** Numbers behind the side profile for the chosen seat. */
export function SeatStats({ seat, stats }: { seat: string | null; stats: Stats | null }) {
  const row = (label: string, value: string) => (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-ink tabular-nums">{value}</dd>
    </div>
  );
  return (
    <dl className="space-y-3 text-sm">
      {row('Сонгосон суудал', seat ?? '—')}
      {row('Дэлгэц хүртэл', stats ? `${stats.distanceM.toFixed(1)} м` : '—')}
      {row('Харах өнцөг', stats ? `${Math.round(stats.viewDeg)}°` : '—')}
      {row('Төвөөс хазайлт', stats ? `${Math.round(stats.offCenterDeg)}°` : '—')}
      {row('Үнэлгээ', stats ? VIEW_LABEL[stats.label] : 'Суудал сонгоно уу')}
    </dl>
  );
}
