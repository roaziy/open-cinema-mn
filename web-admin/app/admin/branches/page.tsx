import type { Metadata } from 'next';
import { BranchesView } from '@/components/branches/BranchesView';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getBranches, getHalls, safely } from '@/lib/admin-data';
import { loadAdminShellData } from '@/lib/shell-data';

export const metadata: Metadata = { title: 'Салбар' };

export default async function BranchesPage() {
  const [branches, halls, shell] = await Promise.all([
    safely(getBranches),
    safely(() => getHalls()),
    loadAdminShellData(),
  ]);
  if (!branches || !halls) {
    return (
      <>
        <PageHeader title="Салбар" />
        <ErrorState message="Салбарын жагсаалтыг ачаалж чадсангүй." />
      </>
    );
  }
  const today = new Map(shell.branches.map((b) => [b.id, b.showtimes]));
  const rows = branches.map((b) => {
    const own = halls.filter((h) => h.branchId === b.id);
    return {
      ...b,
      halls: own.length,
      seats: own.reduce((n, h) => n + h.seatCount, 0),
      today: today.get(b.id) ?? 0,
    };
  });
  return <BranchesView branches={rows} />;
}
