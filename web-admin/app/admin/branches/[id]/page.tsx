import { Armchair, Plus } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BranchEditButton } from '@/components/branches/BranchEditButton';
import { buttonClass } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconTile } from '@/components/ui/IconTile';
import { PageHeader } from '@/components/ui/PageHeader';
import { getBranches, getHalls, safely } from '@/lib/admin-data';
import { count } from '@/lib/format';
import { hueFor } from '@/lib/hues';

export const metadata: Metadata = { title: 'Салбар' };

type Props = { params: Promise<{ id: string }> };

export default async function BranchPage({ params }: Props) {
  const { id } = await params;
  const [branches, halls] = await Promise.all([safely(getBranches), safely(() => getHalls(id))]);
  if (!branches || !halls) {
    return (
      <>
        <PageHeader title="Салбар" />
        <ErrorState message="Салбарын мэдээллийг ачаалж чадсангүй." />
      </>
    );
  }
  const branch = branches.find((b) => b.id === id);
  if (!branch) notFound();
  const hue = hueFor(branch.id);
  return (
    <>
      <PageHeader
        title={branch.name}
        subtitle={branch.address}
        action={
          <div className="flex gap-2">
            <BranchEditButton branch={branch} />
            <Link href={`/admin/halls/new?branch=${branch.id}`} className={buttonClass('primary')}>
              <Plus size={16} aria-hidden />
              Шинэ заал
            </Link>
          </div>
        }
      />
      {halls.length === 0 ? (
        <Empty title="Энэ салбарт заал алга">
          Заал нэмж, суудлын зохион байгуулалтыг тохируулна.
        </Empty>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {halls.map((h) => (
            <li key={h.id}>
              <Link
                href={`/admin/halls/${h.id}`}
                className="focus-ring highlight flex items-center gap-3 rounded-panel border border-hairline bg-raised p-3.5 transition-colors hover:border-white/15"
              >
                <IconTile hue={hue} size={34}>
                  <Armchair size={19} weight="fill" />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{h.name}</p>
                  <p className="text-xs text-muted">
                    Дэлгэц {h.screen_width_m} × {h.screen_height_m} м
                  </p>
                </div>
                <p className="text-[15px] font-semibold text-ink tabular-nums">
                  {count(h.seatCount)}{' '}
                  <span className="text-xs font-normal text-muted">суудал</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
