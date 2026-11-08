import type { ReactNode } from 'react';

/** Honest empty state: says what is missing and what to do about it. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-panel border border-dashed border-white/10 px-6 py-10 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}
