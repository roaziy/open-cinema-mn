import type { Metadata } from 'next';
import Link from 'next/link';
import { DayBars } from '@/components/charts/DayBars';
import { BranchPills } from '@/components/dashboard/BranchPills';
import { RankedBars } from '@/components/reports/RankedBars';
import { buttonClass } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { getBranches, getReport, safely } from '@/lib/admin-data';
import { addDays, count, dayMonth, isDate, mnt, pct, todayUb, weekdayMn } from '@/lib/format';
import { hueFor } from '@/lib/hues';

export const metadata: Metadata = { title: 'Тайлан' };

type Props = {
  searchParams: Promise<{ from?: string; to?: string; branch?: string; view?: string }>;
};

const VIEWS = [
  { key: 'day', label: 'Өдрөөр' },
  { key: 'movie', label: 'Киногоор' },
  { key: 'hall', label: 'Заалаар' },
] as const;

const MAX_DAYS = 366;

const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export default async function ReportsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const today = todayUb();
  let from = isDate(sp.from) ? sp.from : addDays(today, -6);
  let to = isDate(sp.to) ? sp.to : today;
  if (from > to) [from, to] = [to, from];
  const tooLong = spanDays(from, to) > MAX_DAYS;
  const view = VIEWS.find((v) => v.key === sp.view)?.key ?? 'day';

  const branches = await safely(getBranches);
  const branchId = branches?.find((b) => b.id === sp.branch)?.id;
  const report = tooLong ? null : await safely(() => getReport({ from, to, branchId }));

  const url = (o: { from?: string; to?: string; view?: string }) => {
    const p = new URLSearchParams({ from: o.from ?? from, to: o.to ?? to, view: o.view ?? view });
    if (branchId) p.set('branch', branchId);
    return `/admin/reports?${p}`;
  };
  const monthStart = `${today.slice(0, 8)}01`;
  const presets = [
    { label: '7 хоног', from: addDays(today, -6), to: today },
    { label: '30 хоног', from: addDays(today, -29), to: today },
    { label: 'Энэ сар', from: monthStart, to: today },
  ];

  return (
    <>
      <PageHeader
        title="Борлуулалт, дүүргэлт"
        subtitle={`${dayMonth(from)} – ${dayMonth(to)} · ${spanDays(from, to)} хоног`}
      />

      <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3">
        <form method="get" action="/admin/reports" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value={view} />
          {branchId && <input type="hidden" name="branch" value={branchId} />}
          <label className="text-xs text-muted">
            <span className="mb-1 block">Эхлэх</span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="focus-ring h-9 rounded-card border border-hairline bg-raised px-3 text-sm text-ink"
            />
          </label>
          <label className="text-xs text-muted">
            <span className="mb-1 block">Дуусах</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="focus-ring h-9 rounded-card border border-hairline bg-raised px-3 text-sm text-ink"
            />
          </label>
          <button type="submit" className={buttonClass('secondary', 'sm')} style={{ height: 36 }}>
            Харуулах
          </button>
        </form>
        <div className="flex gap-1.5">
          {presets.map((p) => (
            <Link
              key={p.label}
              href={url({ from: p.from, to: p.to })}
              className={`focus-ring rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                p.from === from && p.to === to
                  ? 'border-white/20 bg-fill text-ink'
                  : 'border-hairline text-muted hover:text-ink'
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>
      {branches && branches.length > 1 && (
        <div className="mb-5">
          <BranchPills
            branches={branches.map((b) => ({ id: b.id, name: b.name, hue: hueFor(b.id) }))}
            active={branchId}
            base="/admin/reports"
            extra={`from=${from}&to=${to}&view=${view}`}
          />
        </div>
      )}

      {tooLong ? (
        <ErrorState message="Хугацаа хэт урт байна. Хамгийн ихдээ 366 хоногийг сонгоно уу." />
      ) : !report ? (
        <ErrorState message="Тайланг ачаалж чадсангүй." />
      ) : (
        <>
          <section
            aria-label="Нийт дүн"
            className="highlight grid divide-y divide-hairline rounded-panel border border-hairline bg-raised sm:grid-cols-3 sm:divide-x sm:divide-y-0"
          >
            {[
              ['Борлуулалт', mnt(report.totals.revenue)],
              ['Тасалбар', count(report.totals.tickets)],
              ['Суудлын дүүргэлт', pct(report.totals.occupancy)],
            ].map(([label, value]) => (
              <div key={label} className="p-5">
                <p className="text-sm text-muted">{label}</p>
                <p className="mt-1 text-[28px] font-semibold leading-tight text-ink tabular-nums">
                  {value}
                </p>
              </div>
            ))}
          </section>

          <div className="mb-3 mt-6">
            <Tabs
              label="Харагдац"
              active={view}
              items={VIEWS.map((v) => ({ key: v.key, label: v.label, href: url({ view: v.key }) }))}
            />
          </div>

          <section className="highlight rounded-panel border border-hairline bg-raised p-5">
            {view === 'day' &&
              (report.byDay.length === 0 ? (
                <Empty title="Энэ хугацаанд мэдээлэл алга" />
              ) : (
                <>
                  <DayBars days={report.byDay} />
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-sm">
                      <thead>
                        <tr className="text-xs text-muted">
                          <th className="pb-2 font-medium">Өдөр</th>
                          <th className="pb-2 text-right font-medium">Тасалбар</th>
                          <th className="pb-2 text-right font-medium">Борлуулалт</th>
                          <th className="pb-2 text-right font-medium">Дүүргэлт</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {[...report.byDay].reverse().map((d) => (
                          <tr key={d.date}>
                            <td className="py-2 text-ink">
                              {dayMonth(d.date)}{' '}
                              <span className="text-muted">{weekdayMn(d.date)}</span>
                            </td>
                            <td className="py-2 text-right text-body tabular-nums">
                              {count(d.tickets)}
                            </td>
                            <td className="py-2 text-right font-medium text-ink tabular-nums">
                              {mnt(d.revenue)}
                            </td>
                            <td className="py-2 text-right text-body tabular-nums">
                              {pct(d.occupancy)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ))}
            {view === 'movie' &&
              (report.byMovie.length === 0 ? (
                <Empty title="Энэ хугацаанд мэдээлэл алга" />
              ) : (
                <RankedBars
                  rows={[...report.byMovie]
                    .sort((a, b) => b.revenue - a.revenue)
                    .map((m) => ({
                      id: m.movieId,
                      label: m.title,
                      hue: hueFor(m.movieId),
                      revenue: m.revenue,
                      tickets: m.tickets,
                      occupancy: m.occupancy,
                    }))}
                />
              ))}
            {view === 'hall' &&
              (report.byHall.length === 0 ? (
                <Empty title="Энэ хугацаанд мэдээлэл алга" />
              ) : (
                <RankedBars
                  rows={[...report.byHall]
                    .sort((a, b) => b.revenue - a.revenue)
                    .map((h) => ({
                      id: h.hallId,
                      label: h.hallName,
                      sub: h.branchName,
                      hue: hueFor(h.hallId),
                      revenue: h.revenue,
                      tickets: h.tickets,
                      occupancy: h.occupancy,
                    }))}
                />
              ))}
          </section>
        </>
      )}
    </>
  );
}
