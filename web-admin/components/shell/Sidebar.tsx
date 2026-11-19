'use client';

import { ChevronsLeft, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ShellData } from '@/lib/shell-data';
import { Logo } from '../ui/Logo';
import { AccountCard } from './AccountCard';
import { type NavChild, NavItem } from './NavItem';
import { ADMIN_NAV, isActive, ROLE_LABEL } from './nav';
import { Rail } from './Rail';
import { TodayProgress } from './TodayProgress';

const COOKIE = 'oc_sb';

export function Sidebar({
  user,
  data,
  initialCollapsed,
  appName,
}: {
  user: { id: string; name: string | null; email: string | null; role: string };
  data: ShellData;
  initialCollapsed: boolean;
  appName: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [open, setOpen] = useState(false);
  // On phones a closed drawer is off-screen but must not be reachable by Tab or screen readers.
  // Unknown until mounted, so the desktop sidebar never starts out inert.
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const sync = () => setPhone(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    // Remembered in a cookie so the server renders the right width on the next load.
    // biome-ignore lint/suspicious/noDocumentCookie: cookieStore is not available in every browser we target
    document.cookie = `${COOKIE}=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
  };

  const branchChildren: NavChild[] = data.branches.map((b) => ({
    id: b.id,
    href: `/admin/branches/${b.id}`,
    label: b.name,
    count: data.failed ? undefined : b.showtimes,
    attention: b.attention,
  }));
  const activeChild = branchChildren.find((c) => isActive(pathname, c.href))?.href ?? null;
  const displayName = user.name ?? user.email ?? 'Админ';
  const close = () => setOpen(false);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-canvas/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Цэс нээх"
          aria-expanded={open}
          className="focus-ring -ml-2 flex size-10 items-center justify-center rounded-card text-body hover:bg-white/[0.05]"
        >
          <Menu size={22} />
        </button>
        <Logo size={26} />
        <span className="text-[15px] font-semibold text-ink">{appName}</span>
      </header>

      {open && (
        <button
          type="button"
          aria-label="Цэс хаах"
          onClick={close}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      )}

      <aside
        inert={phone && !open}
        aria-label="Үндсэн цэс"
        className={`fixed inset-y-0 left-0 z-50 w-[288px] max-w-[88vw] p-2 transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-auto lg:max-w-none lg:translate-x-0 lg:pr-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="highlight flex h-full gap-1 rounded-rail border border-hairline bg-surface p-1">
          {collapsed && (
            <Rail groups={ADMIN_NAV} pathname={pathname} onToggle={toggle} user={user} />
          )}
          <div
            className={`min-w-0 flex-1 flex-col rounded-panel border border-hairline bg-raised lg:w-[248px] lg:flex-none ${collapsed ? 'flex lg:hidden' : 'flex'}`}
          >
            <div className="flex items-center gap-2.5 px-3.5 pb-2 pt-3.5">
              <Link
                href="/admin"
                aria-label="Нүүр"
                className="focus-ring hidden rounded-tile lg:block"
              >
                <Logo size={30} />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold leading-tight text-ink">
                  {appName}
                </p>
                <p className="text-xs leading-tight text-muted">Удирдлагын самбар</p>
              </div>
              <button
                type="button"
                onClick={toggle}
                aria-label="Цэсийг хураах"
                aria-expanded={!collapsed}
                className="focus-ring hidden size-8 items-center justify-center rounded-card text-muted hover:bg-white/[0.05] hover:text-ink lg:flex"
              >
                <ChevronsLeft size={16} />
              </button>
              <button
                type="button"
                onClick={close}
                aria-label="Цэс хаах"
                className="focus-ring flex size-8 items-center justify-center rounded-card text-muted hover:bg-white/[0.05] hover:text-ink lg:hidden"
              >
                <X size={18} />
              </button>
            </div>

            <nav aria-label="Удирдлага" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {ADMIN_NAV.map((group) => (
                <section key={group.key} className="mt-3 first:mt-1">
                  <h2 className="px-1.5 pb-1.5 text-xs font-medium text-muted">{group.label}</h2>
                  <ul className="flex flex-col gap-0.5">
                    {group.items.map((item) => (
                      <NavItem
                        key={item.href}
                        item={item}
                        active={isActive(pathname, item.href)}
                        count={
                          item.count === undefined
                            ? undefined
                            : data.failed
                              ? '–'
                              : data.today[item.count]
                        }
                        attention={item.count === 'admitted' ? data.today.attention : undefined}
                        childItems={item.branches ? branchChildren : undefined}
                        activeChildHref={item.branches ? activeChild : null}
                        onNavigate={close}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </nav>

            <div className="flex flex-col gap-2 p-2">
              <TodayProgress
                sold={data.today.sold}
                capacity={data.today.capacity}
                failed={data.failed}
              />
              <AccountCard
                id={user.id}
                name={displayName}
                role={ROLE_LABEL[user.role] ?? user.role}
                detail={user.name ? user.email : null}
                loginPath="/login"
                accountHref="/admin/account"
              />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
