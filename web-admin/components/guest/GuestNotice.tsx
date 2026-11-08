import type { ReactNode } from 'react';
import { Logo } from '@/components/ui/Logo';
import { APP_NAME } from '@/lib/env';

/** A full-page message on the guest ticket route: a bad link, a down server. */
export function GuestNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-6 px-5 py-10">
      <div className="flex items-center gap-2.5">
        <Logo size={28} />
        <p className="text-[15px] font-semibold text-ink">{APP_NAME}</p>
      </div>
      <div className="rounded-rail border border-hairline bg-surface p-6">
        <h1 className="text-[24px] leading-tight font-semibold text-ink">{title}</h1>
        <div className="mt-3 flex flex-col gap-3 text-[16px] leading-relaxed text-body">
          {children}
        </div>
      </div>
    </main>
  );
}
