import type { AdminMovie } from '@open-cinema/shared';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Poster } from '@/components/ui/Poster';
import { getMovies, safely } from '@/lib/admin-data';
import { dayMonth } from '@/lib/format';

export const metadata: Metadata = { title: 'Кино' };

const GROUPS: { status: AdminMovie['status']; title: string; empty: string }[] = [
  { status: 'now', title: 'Үзүүлж байгаа', empty: 'Одоо үзүүлж буй кино алга.' },
  { status: 'soon', title: 'Удахгүй', empty: 'Удахгүй гарах кино алга.' },
  { status: 'archived', title: 'Архив', empty: '' },
];

export default async function MoviesPage() {
  const movies = await safely(getMovies);
  const add = (
    <Link href="/admin/movies/new" className={buttonClass('primary')}>
      <Plus size={16} aria-hidden />
      Шинэ кино
    </Link>
  );

  if (!movies) {
    return (
      <>
        <PageHeader title="Кино" action={add} />
        <ErrorState message="Киноны жагсаалтыг ачаалж чадсангүй." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Кино" subtitle={`Нийт ${movies.length} кино`} action={add} />
      <div className="space-y-8">
        {GROUPS.map((g) => {
          const rows = movies.filter((m) => m.status === g.status);
          if (rows.length === 0 && !g.empty) return null;
          return (
            <section key={g.status} aria-labelledby={`g-${g.status}`}>
              <h2
                id={`g-${g.status}`}
                className="mb-3 flex items-baseline gap-2 text-[15px] font-semibold text-ink"
              >
                {g.title}
                <span className="text-[13px] font-normal text-muted tabular-nums">
                  {rows.length}
                </span>
              </h2>
              {rows.length === 0 ? (
                <Empty title={g.empty} />
              ) : (
                <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                  {rows.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`/admin/movies/${m.id}`}
                        className="focus-ring group block rounded-card"
                      >
                        <Poster
                          src={m.posterUrl}
                          title={m.title}
                          tone={m.tone}
                          className="aspect-[2/3] w-full rounded-panel border border-hairline transition-transform duration-200 group-hover:-translate-y-0.5"
                        />
                        <div className="mt-2.5 flex items-start gap-2">
                          <span
                            aria-hidden
                            className="mt-1.5 size-2.5 shrink-0 rounded-full"
                            style={{ background: m.tone }}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{m.title}</p>
                            <p className="truncate text-xs text-muted">
                              {m.ageRating} · {m.durationMin} мин · {dayMonth(m.releaseDate)}
                            </p>
                          </div>
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
    </>
  );
}
