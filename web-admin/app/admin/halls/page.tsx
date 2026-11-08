import { Armchair, Lock, Plus } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconTile } from '@/components/ui/IconTile';
import { PageHeader } from '@/components/ui/PageHeader';
import { getBranches, getHalls, safely } from '@/lib/admin-data';
import { count } from '@/lib/format';
import { hueFor } from '@/lib/hues';

export const metadata: Metadata = { title: 'Заал' };

export default async function HallsPage() {
  const [branches, halls] = await Promise.all([safely(getBranches), safely(() => getHalls())]);
  const add = (
    <Link href="/admin/halls/new" className={buttonClass('primary')}>
      <Plus size={16} weight="bold" aria-hidden />
      Шинэ заал
    </Link>
  );
  if (!branches || !halls) {
    return (
      <>
        <PageHeader title="Заал" action={add} />
        <ErrorState message="Заалын жагсаалтыг ачаалж чадсангүй." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Заал"
        subtitle={`Нийт ${halls.length} заал, ${branches.length} салбар`}
        action={add}
      />
      {branches.length === 0 ? (
        <Empty title="Салбар алга">
          Заал нэмэхийн өмнө{' '}
          <Link href="/admin/branches" className="text-ink underline underline-offset-2">
            салбар нэмнэ үү
          </Link>
          .
        </Empty>
      ) : (
        <div className="space-y-6">
          {branches.map((b) => {
            const rows = halls.filter((h) => h.branchId === b.id);
            const hue = hueFor(b.id);
            return (
              <section key={b.id} aria-labelledby={`b-${b.id}`}>
                <h2
                  id={`b-${b.id}`}
                  className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold text-ink"
                >
                  <IconTile hue={hue} size={22}>
                    <Armchair size={13} weight="fill" />
                  </IconTile>
                  {b.name}
                  <span className="text-[13px] font-normal text-muted tabular-nums">
                    {rows.length}
                  </span>
                </h2>
                {rows.length === 0 ? (
                  <Empty title="Энэ салбарт заал алга">
                    <Link
                      href={`/admin/halls/new?branch=${b.id}`}
                      className="text-ink underline underline-offset-2"
                    >
                      Заал нэмэх
                    </Link>
                  </Empty>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                    {rows.map((h) => (
                      <li key={h.id}>
                        <Link
                          href={`/admin/halls/${h.id}`}
                          className="focus-ring highlight flex items-center gap-3 rounded-panel border border-hairline bg-raised p-3.5 transition-colors hover:border-white/15"
                        >
                          <IconTile hue={hue} size={34}>
                            <Armchair size={19} weight="fill" />
                          </IconTile>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
                              {h.name}
                              {h.locked && (
                                <Lock
                                  size={12}
                                  weight="fill"
                                  className="shrink-0 text-muted"
                                  aria-label="Тасалбар олгогдсон, бүтэц түгжигдсэн"
                                />
                              )}
                            </p>
                            <p className="text-xs text-muted">
                              Дэлгэц {h.screen_width_m} × {h.screen_height_m} м
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[15px] font-semibold text-ink tabular-nums">
                              {count(h.seatCount)}
                            </p>
                            <p className="text-xs text-muted">суудал</p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
