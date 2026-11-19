import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BranchPills } from '@/components/dashboard/BranchPills';
import { AutoRefresh } from '@/components/staff/AutoRefresh';
import { TodayList } from '@/components/staff/TodayList';
import { Empty } from '@/components/ui/Empty';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getBranches, getTodayAll, safely } from '@/lib/admin-data';
import { businessToday, count, dayMonth, weekdayMn } from '@/lib/format';
import { HUES, hueFor } from '@/lib/hues';
import { isUuid } from '@/lib/ids';

export const metadata: Metadata = { title: 'Өнөөдрийн сеанс' };

type Props = { searchParams: Promise<{ branch?: string }> };

export default async function TodayPage({ searchParams }: Props) {
  const { branch } = await searchParams;
  const [branches, rows] = await Promise.all([safely(getBranches), safely(getTodayAll)]);
  const now = Date.now();
  const today = businessToday(new Date(now));
  const title = 'Өнөөдрийн сеанс';
  const subtitle = `${weekdayMn(today)}, ${dayMonth(today)}`;
  if (!rows || !branches) {
    return (
      <>
        <PageHeader title={title} subtitle={subtitle} />
        <ErrorState message="Өнөөдрийн сеансыг ачаалж чадсангүй." />
      </>
    );
  }
  const active = isUuid(branch) ? branches.find((b) => b.id === branch)?.id : undefined;
  if (branch && !active) redirect('/admin/today');
  const shown = branches.filter((b) => !active || b.id === active);
  const visible = rows.filter((r) => !active || r.branchId === active);
  const sold = visible.reduce((n, r) => n + r.sold, 0);
  const admitted = visible.reduce((n, r) => n + r.admitted, 0);
  const pills = branches.map((b) => ({ id: b.id, name: b.name, hue: hueFor(b.id) }));

  return (
    <>
      <AutoRefresh seconds={15} />
      <PageHeader
        title={title}
        subtitle={
          visible.length
            ? `${subtitle} · ${visible.length} сеанс · ${count(admitted)} / ${count(sold)} орсон`
            : subtitle
        }
      />
      {pills.length > 1 && (
        <div className="-mt-3 mb-5">
          <BranchPills branches={pills} active={active} base="/admin/today" />
        </div>
      )}
      {visible.length === 0 ? (
        <Empty title="Өнөөдөр товлогдсон сеанс алга">
          Сеанс нэмэхийн тулд «Үзвэр» хэсгийг ашиглана уу.
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {shown.map((b) => {
            const mine = visible.filter((r) => r.branchId === b.id);
            if (mine.length === 0) return null;
            return (
              <section key={b.id} aria-labelledby={`b-${b.id}`}>
                <h2
                  id={`b-${b.id}`}
                  className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold text-ink"
                >
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full"
                    style={{ background: HUES[hueFor(b.id)] }}
                  />
                  {b.name}
                </h2>
                <TodayList
                  rows={mine}
                  now={now}
                  scansHref={(r) =>
                    `/admin/scans?${new URLSearchParams({ date: today, showtime: r.id })}`
                  }
                />
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
