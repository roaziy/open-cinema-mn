import { formatUbTime } from '@open-cinema/shared';
import {
  ArrowCounterClockwise,
  ChartLineUp,
  Percent,
  Ticket,
} from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { HourlyChart } from '@/components/charts/HourlyChart';
import { BranchPills } from '@/components/dashboard/BranchPills';
import { Delta } from '@/components/dashboard/Delta';
import { Empty } from '@/components/ui/Empty';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconTile } from '@/components/ui/IconTile';
import { PageHeader } from '@/components/ui/PageHeader';
import { Poster } from '@/components/ui/Poster';
import { getBranches, getDashboard, safely } from '@/lib/admin-data';
import { count, mnt, pct } from '@/lib/format';
import { hueFor } from '@/lib/hues';

export const metadata: Metadata = { title: 'Хяналтын самбар' };

type Props = { searchParams: Promise<{ branch?: string }> };

export default async function Dashboard({ searchParams }: Props) {
  const { branch } = await searchParams;
  const branches = await safely(getBranches);
  const active = branches?.find((b) => b.id === branch)?.id;
  const data = await safely(() => getDashboard(active));

  const pills = (branches ?? []).map((b) => ({ id: b.id, name: b.name, hue: hueFor(b.id) }));
  const header = (
    <PageHeader
      title="Хяналтын самбар"
      subtitle="Өнөөдрийн борлуулалт, дүүргэлт, дараагийн сеансууд"
    />
  );

  if (!data) {
    return (
      <>
        {header}
        <ErrorState message="Хяналтын самбарын мэдээллийг ачаалж чадсангүй." />
      </>
    );
  }

  const nowHour = Number(formatUbTime(new Date()).slice(0, 2));
  const maxFilm = Math.max(...data.topFilms.map((f) => f.revenue), 1);
  const quiet = data.today.tickets === 0;

  return (
    <>
      {header}
      {pills.length > 1 && (
        <div className="-mt-3 mb-5">
          <BranchPills branches={pills} active={active} base="/admin" />
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section
          aria-labelledby="sales-h"
          className="highlight rounded-panel border border-hairline bg-raised p-5"
        >
          <div className="flex items-start gap-3">
            <IconTile hue="green" size={30}>
              <ChartLineUp size={18} weight="fill" />
            </IconTile>
            <div className="min-w-0">
              <h2 id="sales-h" className="text-sm text-muted">
                Өнөөдрийн борлуулалт
              </h2>
              <p className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.01em] text-ink tabular-nums">
                {mnt(data.today.revenue)}
              </p>
              <div className="mt-2">
                <Delta
                  now={data.today.revenue}
                  before={data.yesterday.revenue}
                  label="өчигдрийн нийт дүнтэй харьцуулахад"
                />
              </div>
            </div>
          </div>
          <div className="mt-5">
            <HourlyChart hours={data.hourlySales} nowHour={nowHour} />
            {quiet && (
              <p className="mt-1 text-center text-[13px] text-muted">
                Өнөөдөр тасалбар хараахан зарагдаагүй байна.
              </p>
            )}
          </div>
        </section>

        <section
          aria-label="Өнөөдрийн үзүүлэлт"
          className="highlight divide-y divide-hairline rounded-panel border border-hairline bg-raised"
        >
          <Stat
            hue="purple"
            icon={<Ticket size={18} weight="fill" />}
            label="Зарагдсан тасалбар"
            value={count(data.today.tickets)}
            foot={
              <Delta
                now={data.today.tickets}
                before={data.yesterday.tickets}
                label="өчигдөртэй харьцуулахад"
              />
            }
          />
          <Stat
            hue="indigo"
            icon={<Percent size={18} weight="fill" />}
            label="Суудлын дүүргэлт"
            value={pct(data.today.occupancy)}
            foot={
              <div className="mt-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-fill">
                  <div
                    className="h-full rounded-full bg-hue-indigo"
                    style={{ width: `${Math.min(100, Math.round(data.today.occupancy * 100))}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[13px] text-muted">
                  Өчигдөр {pct(data.yesterday.occupancy)}
                </p>
              </div>
            }
          />
          <Stat
            hue="red"
            icon={<ArrowCounterClockwise size={18} weight="fill" />}
            label="Өнөөдрийн буцаалт"
            value={count(data.refundsToday.count)}
            foot={
              <span className="text-[13px] text-muted">
                {data.refundsToday.count === 0
                  ? 'Буцаалт хийгдээгүй'
                  : `Нийт ${mnt(data.refundsToday.amount)}`}
              </span>
            }
          />
        </section>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section
          aria-labelledby="top-h"
          className="highlight rounded-panel border border-hairline bg-raised p-5"
        >
          <h2 id="top-h" className="mb-4 text-[15px] font-semibold text-ink">
            Өнөөдрийн шилдэг кино
          </h2>
          {data.topFilms.length === 0 ? (
            <Empty title="Өнөөдөр борлуулалт алга">Тасалбар зарагдахад эндээс харагдана.</Empty>
          ) : (
            <ol className="space-y-3.5">
              {data.topFilms.map((f, i) => (
                <li key={f.movieId} className="flex items-center gap-3">
                  <span className="w-4 text-center text-[13px] text-muted tabular-nums">
                    {i + 1}
                  </span>
                  <Poster
                    src={f.posterUrl}
                    title={f.title}
                    tone={f.tone}
                    className="h-[60px] w-10"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-sm font-medium text-ink">{f.title}</p>
                      <p className="shrink-0 text-sm text-ink tabular-nums">{mnt(f.revenue)}</p>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(f.revenue / maxFilm) * 100}%`, background: f.tone }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted">{count(f.tickets)} тасалбар</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          aria-labelledby="up-h"
          className="highlight rounded-panel border border-hairline bg-raised p-5"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 id="up-h" className="text-[15px] font-semibold text-ink">
              Дараагийн сеанс
            </h2>
            <Link
              href="/admin/schedule"
              className="focus-ring rounded text-[13px] text-muted transition-colors hover:text-ink"
            >
              Хуваарь харах
            </Link>
          </div>
          {data.upcoming.length === 0 ? (
            <Empty title="Удахгүй эхлэх сеанс алга">
              <Link href="/admin/schedule" className="text-ink underline underline-offset-2">
                Хуваарьт сеанс нэмэх
              </Link>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="pb-2 pr-3 font-medium">Цаг</th>
                    <th className="pb-2 pr-3 font-medium">Кино</th>
                    <th className="pb-2 pr-3 font-medium">Заал</th>
                    <th className="pb-2 text-right font-medium">Дүүргэлт</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {data.upcoming.map((u) => {
                    const ratio = u.capacity > 0 ? u.sold / u.capacity : 0;
                    return (
                      <tr key={u.id}>
                        <td className="py-2.5 pr-3 font-medium text-ink tabular-nums">
                          {formatUbTime(u.startsAt)}
                        </td>
                        <td className="max-w-[200px] truncate py-2.5 pr-3 text-ink">
                          {u.movieTitle}
                        </td>
                        <td className="py-2.5 pr-3 text-muted">
                          {u.hallName}
                          <span className="text-muted/70"> · {u.branchName}</span>
                        </td>
                        <td className="py-2.5">
                          <div className="ml-auto flex items-center justify-end gap-2.5">
                            <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-fill sm:block">
                              <div
                                className="h-full rounded-full bg-hue-green"
                                style={{ width: `${Math.round(ratio * 100)}%` }}
                              />
                            </div>
                            <span className="w-[68px] text-right text-[13px] text-body tabular-nums">
                              {u.sold}/{u.capacity}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Stat({
  hue,
  icon,
  label,
  value,
  foot,
}: {
  hue: 'purple' | 'indigo' | 'red';
  icon: React.ReactNode;
  label: string;
  value: string;
  foot: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 p-4">
      <IconTile hue={hue} size={30}>
        {icon}
      </IconTile>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted">{label}</p>
        <p className="mt-0.5 text-[26px] font-semibold leading-tight text-ink tabular-nums">
          {value}
        </p>
        <div className="mt-0.5">{foot}</div>
      </div>
    </div>
  );
}
