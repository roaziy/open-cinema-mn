import { CaretLeft, CaretRight } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BranchPills } from '@/components/dashboard/BranchPills';
import { DateJump } from '@/components/schedule/DateJump';
import { ScheduleView } from '@/components/schedule/ScheduleView';
import { buttonClass } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getBranches, getHalls, getMovies, getShowtimes, safely } from '@/lib/admin-data';
import { addDays, dayMonth, isDate, todayUb, weekdayMn } from '@/lib/format';
import { hueFor } from '@/lib/hues';

export const metadata: Metadata = { title: 'Сеанс, үнэ' };

type Props = { searchParams: Promise<{ date?: string; branch?: string }> };

export default async function SchedulePage({ searchParams }: Props) {
  const sp = await searchParams;
  const today = todayUb();
  const date = isDate(sp.date) ? sp.date : today;
  const branches = await safely(getBranches);
  const branchId = branches?.find((b) => b.id === sp.branch)?.id;

  const [halls, showtimes, movies] = await Promise.all([
    safely(() => getHalls(branchId)),
    safely(() => getShowtimes({ from: date, to: date, branchId })),
    safely(getMovies),
  ]);

  const href = (d: string) => {
    const p = new URLSearchParams({ date: d });
    if (branchId) p.set('branch', branchId);
    return `/admin/schedule?${p}`;
  };

  const header = (
    <PageHeader
      title="Сеанс, үнэ"
      subtitle={`${dayMonth(date)}, ${weekdayMn(date)}${date === today ? ' · өнөөдөр' : ''}`}
      action={
        <div className="flex items-center gap-2">
          <Link
            href={href(addDays(date, -1))}
            aria-label="Өмнөх өдөр"
            className={`${buttonClass('secondary')} !px-2.5`}
          >
            <CaretLeft size={16} />
          </Link>
          <DateJump date={date} branch={branchId} />
          <Link
            href={href(addDays(date, 1))}
            aria-label="Дараах өдөр"
            className={`${buttonClass('secondary')} !px-2.5`}
          >
            <CaretRight size={16} />
          </Link>
          {date !== today && (
            <Link href={href(today)} className={buttonClass('ghost')}>
              Өнөөдөр
            </Link>
          )}
        </div>
      }
    />
  );

  if (!branches || !halls || !showtimes || !movies) {
    return (
      <>
        {header}
        <ErrorState message="Хуваарийг ачаалж чадсангүй." />
      </>
    );
  }

  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const rows = halls
    .map((h) => ({
      id: h.id,
      name: h.name,
      branchId: h.branchId,
      branchName: branchName.get(h.branchId) ?? '',
      hue: hueFor(h.branchId),
    }))
    .sort(
      (a, b) =>
        a.branchName.localeCompare(b.branchName, 'mn') || a.name.localeCompare(b.name, 'mn'),
    );

  return (
    <>
      {header}
      {branches.length > 1 && (
        <div className="-mt-3 mb-4">
          <BranchPills
            branches={branches.map((b) => ({ id: b.id, name: b.name, hue: hueFor(b.id) }))}
            active={branchId}
            base="/admin/schedule"
            extra={`date=${date}`}
          />
        </div>
      )}
      <ScheduleView
        date={date}
        isToday={date === today}
        nowMs={Date.now()}
        halls={rows}
        showtimes={showtimes.items}
        movies={movies}
        truncated={showtimes.truncated}
      />
    </>
  );
}
