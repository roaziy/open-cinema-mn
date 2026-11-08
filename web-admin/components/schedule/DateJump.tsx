'use client';

import { useRouter } from 'next/navigation';

/** Jump to any day: the date lives in the URL, so a change is just a navigation. */
export function DateJump({ date, branch }: { date: string; branch?: string }) {
  const router = useRouter();
  return (
    <input
      type="date"
      aria-label="Огноо сонгох"
      value={date}
      onChange={(e) =>
        e.target.value &&
        router.push(`/admin/schedule?date=${e.target.value}${branch ? `&branch=${branch}` : ''}`)
      }
      className="focus-ring h-9 rounded-card border border-hairline bg-raised px-3 text-sm text-ink hover:border-white/15"
    />
  );
}
