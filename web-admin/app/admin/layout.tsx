import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/shell/Sidebar';
import { APP_NAME } from '@/lib/env';
import { requireRole } from '@/lib/session';
import { loadAdminShellData } from '@/lib/shell-data';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole('admin');
  const [data, jar] = await Promise.all([loadAdminShellData(), cookies()]);

  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar
        user={{ id: user.id, name: user.name, email: user.email, role: user.role }}
        data={data}
        initialCollapsed={jar.get('oc_sb')?.value === '1'}
        appName={APP_NAME}
      />
      <main className="min-w-0 flex-1 p-2">
        <div className="highlight min-h-[calc(100dvh-1rem)] rounded-rail border border-hairline bg-surface p-5 sm:p-7 lg:min-h-[calc(100dvh-1rem)]">
          {children}
        </div>
      </main>
    </div>
  );
}
