'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** A failed load that says so, with a way to try again. */
export function ErrorState({ message }: { message: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-panel border border-hue-red/25 bg-hue-red/10 p-4"
    >
      <p className="text-[15px] text-body">{message}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => router.refresh())}
        className="focus-ring h-10 rounded-card bg-action px-4 text-sm font-semibold text-white transition-colors hover:bg-action-hover disabled:opacity-70"
      >
        {pending ? 'Ачаалж байна…' : 'Дахин оролдох'}
      </button>
    </div>
  );
}
