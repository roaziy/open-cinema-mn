'use client';

import { ChevronsRight } from 'lucide-react';
import Link from 'next/link';
import { Avatar } from '../ui/Avatar';
import { Logo } from '../ui/Logo';
import { isActive, type NavGroupDef } from './nav';

/** The slim strip shown only while the sidebar is collapsed: logo, one icon per section, expand toggle, your avatar. */
export function Rail({
  groups,
  pathname,
  onToggle,
  user,
}: {
  groups: NavGroupDef[];
  pathname: string;
  onToggle: () => void;
  user: { id: string; name: string | null };
}) {
  return (
    <div className="hidden w-12 shrink-0 flex-col items-center gap-1 py-2 lg:flex">
      <Link href="/admin" aria-label="Нүүр" className="focus-ring mb-2 rounded-tile">
        <Logo size={32} />
      </Link>
      <nav aria-label="Бүлгүүд" className="flex flex-col items-center gap-1.5">
        {groups.map((g) => {
          const Icon = g.icon;
          const on = g.items.some((i) => isActive(pathname, i.href));
          const first = g.items[0];
          return (
            <Link
              key={g.key}
              href={first ? first.href : '/admin'}
              aria-label={g.label}
              title={g.label}
              aria-current={on ? 'true' : undefined}
              className={`focus-ring relative flex size-9 items-center justify-center rounded-card transition-colors ${on ? 'bg-fill text-ink' : 'text-muted hover:bg-white/[0.05] hover:text-ink'}`}
            >
              {on && (
                <span
                  aria-hidden
                  className="absolute -left-1 top-2 bottom-2 w-[3px] rounded-full bg-action"
                />
              )}
              <Icon size={18} strokeWidth={1.75} />
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Цэсийг нээх"
          aria-expanded={false}
          className="focus-ring flex size-8 items-center justify-center rounded-card text-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
        >
          {<ChevronsRight size={16} />}
        </button>
        <Avatar seed={user.id} name={user.name} size={30} />
      </div>
    </div>
  );
}
