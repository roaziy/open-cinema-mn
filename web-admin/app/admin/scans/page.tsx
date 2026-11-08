import { ScanResultCodeSchema } from '@open-cinema/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BranchPills } from '@/components/dashboard/BranchPills';
import { ResultPills } from '@/components/scans/ResultPills';
import { ScanTable } from '@/components/scans/ScanTable';
import { DateJump } from '@/components/schedule/DateJump';
import { buttonClass } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getBranches, getScans, safely } from '@/lib/admin-data';
import { businessToday, dayMonth, isDate, weekdayMn } from '@/lib/format';
import { hueFor } from '@/lib/hues';
import { isUuid } from '@/lib/ids';

export const metadata: Metadata = { title: 'Шалгалт' };

type Props = {
  searchParams: Promise<{
    branch?: string;
    date?: string;
    result?: string;
    showtime?: string;
    cursor?: string;
  }>;
};

const query = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  return p.toString();
};

export default async function ScansPage({ searchParams }: Props) {
  const q = await searchParams;
  const date = isDate(q.date) ? q.date : businessToday();
  const parsed = ScanResultCodeSchema.safeParse(q.result);
  const result = parsed.success ? parsed.data : undefined;
  const showtimeId = isUuid(q.showtime) ? q.showtime : undefined;
  const [branches, page] = await Promise.all([
    safely(getBranches),
    safely(() =>
      getScans({
        branchId: isUuid(q.branch) ? q.branch : undefined,
        date,
        showtimeId,
        result,
        cursor: q.cursor && q.cursor.length <= 200 ? q.cursor : undefined,
      }),
    ),
  ]);
  const active = branches?.find((b) => b.id === q.branch)?.id;
  if (q.branch && branches && !active) redirect('/admin/scans');

  const pills = (branches ?? []).map((b) => ({ id: b.id, name: b.name, hue: hueFor(b.id) }));
  const nextHref = (cursor: string) =>
    `/admin/scans?${query({ branch: active, date, result, showtime: showtimeId, cursor })}`;

  return (
    <>
      <PageHeader
        title="Шалгалт"
        subtitle={`${weekdayMn(date)}, ${dayMonth(date)} · хаалган дээр уншуулсан тасалбарууд`}
        action={
          <DateJump
            date={date}
            branch={active}
            base="/admin/scans"
            extra={query({ result, showtime: showtimeId })}
          />
        }
      />
      <div className="mb-5 flex flex-col gap-3">
        {pills.length > 1 && (
          <BranchPills
            branches={pills}
            active={active}
            base="/admin/scans"
            extra={query({ date, result, showtime: showtimeId })}
          />
        )}
        <ResultPills active={result} params={{ branch: active, date, showtime: showtimeId }} />
        {showtimeId && (
          <p className="text-[13px] text-muted">
            Нэг сеансаар шүүсэн.{' '}
            <Link
              href={`/admin/scans?${query({ branch: active, date, result })}`}
              className="text-ink underline underline-offset-2"
            >
              Бүх сеанс
            </Link>
          </p>
        )}
      </div>

      {!page ? (
        <ErrorState message="Шалгалтын жагсаалтыг ачаалж чадсангүй." />
      ) : page.items.length === 0 ? (
        <Empty title="Энэ өдөр уншилт байхгүй">Шүүлтүүрээ өөрчилж эсвэл өөр өдөр сонгоно уу.</Empty>
      ) : (
        <>
          <ScanTable items={page.items} />
          {page.nextCursor && (
            <div className="mt-4 flex justify-center">
              <Link href={nextHref(page.nextCursor)} className={buttonClass('secondary')}>
                Цааш харах
              </Link>
            </div>
          )}
        </>
      )}
    </>
  );
}
