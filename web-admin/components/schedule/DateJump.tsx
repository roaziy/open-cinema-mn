'use client';

import { useRouter } from 'next/navigation';

/** Jump to any day: the date lives in the URL, so a change is just a navigation. */
export function DateJump({
  date,
  branch,
  base = '/admin/schedule',
  extra = '',
}: {
  date: string;
  branch?: string;
  base?: string;
  /** Other query parameters to keep, already encoded (`result=admitted`). */
  extra?: string;
}) {
  const router = useRouter();
  return (
    <input
      type="date"
      aria-label="Огноо сонгох"
      value={date}
      onChange={(e) =>
        e.target.value &&
        router.push(
          `${base}?date=${e.target.value}${branch ? `&branch=${branch}` : ''}${extra ? `&${extra}` : ''}`,
        )
      }
      className="focus-ring h-9 rounded-card border border-hairline bg-raised px-3 text-sm text-ink hover:border-white/15"
    />
  );
}
