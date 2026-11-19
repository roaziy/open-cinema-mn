'use client';

import { Building2, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { PageHeader } from '@/components/ui/PageHeader';
import { count } from '@/lib/format';
import type { Branch } from '@/lib/shared';
import { BranchDrawer } from './BranchDrawer';

export type BranchRow = Branch & { halls: number; seats: number; today: number };

export function BranchesView({ branches }: { branches: BranchRow[] }) {
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Салбар"
        subtitle={`Нийт ${branches.length} салбар`}
        action={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden />
            Шинэ салбар
          </Button>
        }
      />
      {branches.length === 0 ? (
        <Empty title="Салбар бүртгэгдээгүй байна">Эхний салбараа нэмээд заал, сеанс үүсгэнэ.</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {branches.map((b) => {
            return (
              <li
                key={b.id}
                className="highlight group relative rounded-panel border border-hairline bg-raised p-4"
              >
                <div className="flex items-start gap-3">
                  <Building2
                    size={22}
                    strokeWidth={1.75}
                    className="mt-0.5 shrink-0 text-muted"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/branches/${b.id}`}
                      className="focus-ring block truncate rounded text-[15px] font-semibold text-ink after:absolute after:inset-0 after:rounded-panel"
                    >
                      {b.name}
                    </Link>
                    <p className="truncate text-[13px] text-muted">{b.address}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(b)}
                    aria-label={`${b.name} засах`}
                    className="focus-ring relative z-10 -mr-1 -mt-1 flex size-8 items-center justify-center rounded-card text-muted transition-colors hover:bg-white/[0.06] hover:text-ink"
                  >
                    <Pencil size={16} />
                  </button>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-hairline pt-3">
                  {[
                    ['Заал', b.halls],
                    ['Суудал', b.seats],
                    ['Өнөөдрийн сеанс', b.today],
                  ].map(([label, v]) => (
                    <div key={label}>
                      <dt className="truncate text-xs text-muted">{label}</dt>
                      <dd className="text-lg font-semibold text-ink tabular-nums">
                        {count(v as number)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
      <BranchDrawer
        key={editing === 'new' || editing === null ? 'new' : editing.id}
        branch={editing === 'new' || editing === null ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
