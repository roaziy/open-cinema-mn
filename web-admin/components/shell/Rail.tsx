'use client';

import { CaretDoubleLeft, CaretDoubleRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Avatar } from '../ui/Avatar';
import { IconTile } from '../ui/IconTile';
import { Logo } from '../ui/Logo';
import { isActive, type NavGroupDef } from './nav';

/** The slim outer strip: logo, one tile per section, collapse toggle, your avatar. */
export function Rail({
  groups,
  pathname,
  collapsed,
  onToggle,
  user,
}: {
  groups: NavGroupDef[];
  pathname: string;
  collapsed: boolean;
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
              className={`focus-ring flex size-9 items-center justify-center rounded-card transition-colors ${on ? 'bg-fill' : 'hover:bg-white/[0.05]'}`}
            >
              <IconTile hue={g.hue} size={24}>
                <Icon size={14} weight="fill" />
              </IconTile>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Цэсийг нээх' : 'Цэсийг хураах'}
          aria-expanded={!collapsed}
          className="focus-ring flex size-8 items-center justify-center rounded-card text-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
        >
          {collapsed ? <CaretDoubleRight size={16} /> : <CaretDoubleLeft size={16} />}
        </button>
        <Avatar seed={user.id} name={user.name} size={30} />
      </div>
    </div>
  );
}
