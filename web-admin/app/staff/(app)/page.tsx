import { QrCode } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { AutoRefresh } from '@/components/staff/AutoRefresh';
import { TodayList } from '@/components/staff/TodayList';
import { buttonClass } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiGet } from '@/lib/api';
import { businessToday, count, dayMonth, weekdayMn } from '@/lib/format';
import { type TodayShowtime, TodayShowtimeSchema } from '@/lib/schemas';

export const metadata: Metadata = { title: 'Өнөөдөр' };

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
  const now = Date.now();
  const today = businessToday(new Date(now));
  const title = `${weekdayMn(today)}, ${dayMonth(today)}`;
  const scanButton = (
    <Link href="/staff/scan" className={`${buttonClass('primary')} h-14 w-full text-[17px]`}>
      <QrCode size={22} weight="fill" />
      Билет шалгах
    </Link>
  );
  if (!rows) {
    return (
      <>
        <PageHeader title={title} />
        <ErrorState message="Өнөөдрийн сеансыг ачаалж чадсангүй." />
      </>
    );
  }
  const sold = rows.reduce((n, r) => n + r.sold, 0);
  const admitted = rows.reduce((n, r) => n + r.admitted, 0);
  return (
    <>
      <AutoRefresh seconds={15} />
      <PageHeader
        title={title}
        subtitle={
          rows.length
            ? `${rows.length} сеанс · ${count(admitted)} / ${count(sold)} орсон`
            : undefined
        }
      />
      <div className="mb-4">{scanButton}</div>
      {rows.length === 0 ? (
        <p className="rounded-panel border border-hairline bg-raised p-4 text-[15px] text-muted">
          Өнөөдөр товлогдсон сеанс алга.
        </p>
      ) : (
        <TodayList rows={rows} now={now} />
      )}
    </>
  );
}
