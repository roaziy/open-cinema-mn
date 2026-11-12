import { unstable_rethrow } from 'next/navigation';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { ROLE_LABEL } from '@/components/shell/nav';
import { StaffShell } from '@/components/shell/StaffShell';
import { apiGet } from '@/lib/api';
import { APP_NAME } from '@/lib/env';
import { requireRole } from '@/lib/session';
import { BranchSchema } from '@/lib/shared';

async function branchName(branchId: string | null): Promise<string | null> {
  if (!branchId) return null;
  try {
    const all = await apiGet('/branches', z.array(BranchSchema));
    return all.find((b) => b.id === branchId)?.name ?? null;
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const user = await requireRole('staff', 'admin');
  const branch = await branchName(user.branchId);
  return (
    <StaffShell
      appName={APP_NAME}
      user={{
        id: user.id,
        name: user.name ?? user.phone ?? user.email ?? 'Ажилтан',
        role: ROLE_LABEL[user.role] ?? user.role,
      }}
      branchName={branch}
    >
      {children}
    </StaffShell>
  );
}
