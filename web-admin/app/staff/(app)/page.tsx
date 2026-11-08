import { Armchair } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconTile } from '@/components/ui/IconTile';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiGet } from '@/lib/api';
import { type TodayShowtime, TodayShowtimeSchema } from '@/lib/schemas';

export const metadata: Metadata = { title: 'Өнөөдөр' };

const time = new Intl.DateTimeFormat('mn', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Ulaanbaatar',
});

async function load(): Promise<TodayShowtime[] | null> {
  try {
    return await apiGet('/staff/today', z.array(TodayShowtimeSchema));
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

export default async function StaffToday() {
  const rows = await load();
  if (!rows) {
    return (
      <>
        <PageHeader title="Өнөөдрийн сеанс" />
        <ErrorState message="Өнөөдрийн сеансыг ачаалж чадсангүй." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Өнөөдрийн сеанс"
        subtitle={rows.length ? `${rows.length} сеанс` : undefined}
      />
      {rows.length === 0 ? (
        <p className="rounded-panel border border-hairline bg-raised p-4 text-[15px] text-muted">
          Өнөөдөр товлогдсон сеанс алга.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="highlight flex items-center gap-3 rounded-panel border border-hairline bg-raised p-3"
            >
              <div className="w-[52px] shrink-0 text-center text-[17px] font-semibold text-ink tabular-nums">
                {time.format(new Date(r.startsAt))}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-ink">{r.movieTitle}</p>
                <p className="text-[13px] text-muted">{r.hallName}</p>
              </div>
              <div className="flex items-center gap-2 text-body">
                <IconTile hue="teal" size={22}>
                  <Armchair size={13} weight="fill" />
                </IconTile>
                <div className="text-right">
                  <p className="text-[13px] leading-tight tabular-nums">
                    {r.admitted}/{r.sold}
                  </p>
                  <p className="text-[11px] leading-tight text-muted">орсон/зарсан</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
