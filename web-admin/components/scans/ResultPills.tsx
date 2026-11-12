import Link from 'next/link';
import { RESULT_TITLES } from '@/lib/scan/card';
import type { ScanResultCode } from '@/lib/shared';

const SHOWN: ScanResultCode[] = [
  'admitted',
  'repeat',
  'already_used',
  'wrong_branch',
  'wrong_day',
  'invalid',
  'undone',
];

/** Result filter as links: `?result=` is the state. Other filters in `params` are kept. */
export function ResultPills({
  active,
  params,
}: {
  active: ScanResultCode | undefined;
  params: Record<string, string | undefined>;
}) {
  const href = (result?: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, result })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/admin/scans?${s}` : '/admin/scans';
  };
  const pill = (on: boolean) =>
    `focus-ring inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium transition-colors ${
      on
        ? 'border-white/20 bg-fill text-ink'
        : 'border-hairline text-muted hover:border-white/15 hover:text-ink'
    }`;
  return (
    <nav aria-label="Үр дүн" className="flex flex-wrap gap-2">
      <Link href={href()} aria-current={!active ? 'page' : undefined} className={pill(!active)}>
        Бүгд
      </Link>
      {SHOWN.map((r) => (
        <Link
          key={r}
          href={href(r)}
          aria-current={active === r ? 'page' : undefined}
          className={pill(active === r)}
        >
          {RESULT_TITLES[r]}
        </Link>
      ))}
    </nav>
  );
}
