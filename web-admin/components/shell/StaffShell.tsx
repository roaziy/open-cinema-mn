'use client';

import { Calendar, QrCode } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '../ui/Logo';
import { AccountCard } from './AccountCard';

const TABS = [
  { href: '/staff', label: 'Өнөөдөр', icon: Calendar },
  { href: '/staff/scan', label: 'Шалгах', icon: QrCode },
] as const;

/** Phone-first: brand and account up top, two big tabs on the bottom edge. */
export function StaffShell({
  appName,
  user,
  branchName,
  children,
}: {
  appName: string;
  user: { id: string; name: string; role: string };
  branchName: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // The scanner owns the whole screen: camera edge to edge, no header or tab bar over it.
  if (pathname.startsWith('/staff/scan')) return <>{children}</>;
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-2.5 px-2 py-2">
        <Logo size={28} />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-tight text-ink">{appName}</p>
          {branchName && <p className="truncate text-xs leading-tight text-muted">{branchName}</p>}
        </div>
      </header>

      <main className="highlight flex-1 rounded-rail border border-hairline bg-surface p-4 sm:p-6">
        {children}
      </main>

      <div className="sticky bottom-0 -mx-2 mt-2 bg-canvas/90 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur">
        <div className="highlight mb-2 rounded-panel border border-hairline bg-surface p-1">
          <AccountCard
            id={user.id}
            name={user.name}
            role={user.role}
            detail={branchName}
            loginPath="/staff/login"
          />
        </div>
        <nav
          aria-label="Ажилтны цэс"
          className="highlight grid grid-cols-2 gap-1 rounded-panel border border-hairline bg-surface p-1"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = t.href === '/staff' ? pathname === '/staff' : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={`focus-ring flex h-12 items-center justify-center gap-2.5 rounded-card text-[15px] font-medium transition-colors ${on ? 'bg-fill text-ink' : 'text-muted hover:text-ink'}`}
              >
                <Icon size={20} strokeWidth={1.75} aria-hidden />
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
