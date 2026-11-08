'use client';

import Link from 'next/link';
import { HUES, type HueKey } from '@/lib/hues';
import { IconTile } from '../ui/IconTile';
import type { NavItemDef } from './nav';

export type NavChild = {
  id: string;
  href: string;
  label: string;
  hue: HueKey;
  count?: number;
  attention?: boolean;
};

function Count({ value }: { value: number | string | undefined }) {
  if (value === undefined) return null;
  return <span className="ml-auto pl-2 text-[13px] text-muted tabular-nums">{value}</span>;
}

function Dot({ show }: { show: boolean | undefined }) {
  if (!show) return null;
  return (
    <span
      role="img"
      aria-label="Анхаарах"
      className="ml-2 size-2 shrink-0 rounded-full bg-hue-red"
    />
  );
}

const row =
  'focus-ring group relative flex min-h-9 items-center gap-2.5 rounded-card px-1.5 text-[14px] font-medium transition-colors';

export function NavItem({
  item,
  active,
  count,
  attention,
  childItems,
  activeChildHref,
  onNavigate,
}: {
  item: NavItemDef;
  active: boolean;
  count?: number | string;
  attention?: boolean;
  childItems?: NavChild[];
  activeChildHref?: string | null;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active && !activeChildHref ? 'page' : undefined}
        className={`${row} ${active ? 'bg-fill text-ink' : 'text-body hover:bg-white/[0.04] hover:text-ink'}`}
      >
        {active && (
          <span
            aria-hidden
            className="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-full bg-action"
          />
        )}
        <IconTile hue={item.hue}>
          <Icon size={16} weight="fill" />
        </IconTile>
        <span className="truncate">{item.label}</span>
        <Count value={count} />
        <Dot show={attention} />
      </Link>

      {childItems && childItems.length > 0 && (
        <ul className="mt-0.5 flex flex-col">
          {childItems.map((child, i) => {
            const last = i === childItems.length - 1;
            const here = activeChildHref === child.href;
            return (
              <li key={child.id} className="relative pl-[34px]">
                {/* Tree connector: elbow into the row, trunk continues to the next sibling. */}
                <span
                  aria-hidden
                  className="absolute left-[19px] top-0 h-1/2 w-3 rounded-bl-[8px] border-b border-l border-white/[0.14]"
                />
                {!last && (
                  <span
                    aria-hidden
                    className="absolute bottom-0 left-[19px] top-1/2 w-px bg-white/[0.14]"
                  />
                )}
                <Link
                  href={child.href}
                  onClick={onNavigate}
                  aria-current={here ? 'page' : undefined}
                  className={`${row} min-h-8 text-[13px] ${here ? 'bg-fill text-ink' : 'text-body hover:bg-white/[0.04] hover:text-ink'}`}
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: HUES[child.hue] }}
                  />
                  <span className="truncate">{child.label}</span>
                  <Count value={child.count} />
                  <Dot show={child.attention} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
