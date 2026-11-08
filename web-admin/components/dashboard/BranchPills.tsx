import Link from 'next/link';
import { HUES, type HueKey } from '@/lib/hues';

/** Branch filter as links: `?branch=` is the state. */
export function BranchPills({
  branches,
  active,
  base,
  extra = '',
}: {
  branches: { id: string; name: string; hue: HueKey }[];
  active: string | undefined;
  base: string;
  extra?: string;
}) {
  const href = (id?: string) => {
    const p = new URLSearchParams(extra);
    if (id) p.set('branch', id);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  const pill = (on: boolean) =>
    `focus-ring inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors ${
      on
        ? 'border-white/20 bg-fill text-ink'
        : 'border-hairline text-muted hover:border-white/15 hover:text-ink'
    }`;
  return (
    <nav aria-label="Салбар" className="flex flex-wrap gap-2">
      <Link href={href()} aria-current={!active ? 'page' : undefined} className={pill(!active)}>
        Бүх салбар
      </Link>
      {branches.map((b) => (
        <Link
          key={b.id}
          href={href(b.id)}
          aria-current={active === b.id ? 'page' : undefined}
          className={pill(active === b.id)}
        >
          <span aria-hidden className="size-2 rounded-full" style={{ background: HUES[b.hue] }} />
          {b.name}
        </Link>
      ))}
    </nav>
  );
}
