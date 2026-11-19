import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BranchPills } from '@/components/dashboard/BranchPills';
import { DateJump } from '@/components/schedule/DateJump';
import { ScheduleView } from '@/components/schedule/ScheduleView';
import { buttonClass } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Notice } from '@/components/ui/Notice';
import { PageHeader } from '@/components/ui/PageHeader';
import { getBranches, getHalls, getMovies, getShowtimes, safely } from '@/lib/admin-data';
import { addDays, dayMonth, isDate, todayUb, weekdayMn } from '@/lib/format';
import { hueFor } from '@/lib/hues';
import { isUuid } from '@/lib/ids';

export const metadata: Metadata = { title: 'Үзвэр' };

type Props = { searchParams: Promise<{ date?: string; branch?: string }> };

export default async function SchedulePage({ searchParams }: Props) {
  const sp = await searchParams;
  const today = todayUb();
  const badDate = sp.date !== undefined && !isDate(sp.date);
  const date = isDate(sp.date) ? sp.date : today;
  const wanted = isUuid(sp.branch) ? sp.branch : undefined;

  const [branches, halls, showtimes, movies] = await Promise.all([
    safely(getBranches),
    safely(() => getHalls(wanted)),
    safely(() => getShowtimes({ from: date, to: date, branchId: wanted })),
    safely(getMovies),
  ]);
  const branchId = branches?.find((b) => b.id === wanted)?.id;
  if (sp.branch && branches && !branchId) redirect(`/admin/schedule?date=${date}`);

  const href = (d: string) => {
    const p = new URLSearchParams({ date: d });
    if (branchId) p.set('branch', branchId);
    return `/admin/schedule?${p}`;
  };

  const header = (
    <PageHeader
      title="Үзвэр"
      subtitle={`${dayMonth(date)}, ${weekdayMn(date)}${date === today ? ' · өнөөдөр' : ''}`}
      action={
        <div className="flex items-center gap-2">
          <Link
            href={href(addDays(date, -1))}
            aria-label="Өмнөх өдөр"
            className={`${buttonClass('secondary')} !px-2.5`}
          >
            <ChevronLeft size={16} />
          </Link>
          <DateJump date={date} branch={branchId} />
          <Link
            href={href(addDays(date, 1))}
            aria-label="Дараах өдөр"
            className={`${buttonClass('secondary')} !px-2.5`}
          >
            <ChevronRight size={16} />
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
      {badDate && (
        <div className="mb-4">
          <Notice>Огнооны хэлбэр буруу байна. Өнөөдрийн хуваарийг харуулж байна.</Notice>
        </div>
      )}
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
