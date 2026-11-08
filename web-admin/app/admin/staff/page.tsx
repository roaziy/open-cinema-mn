import type { Metadata } from 'next';
import { StaffView } from '@/components/staff/StaffView';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getBranches, getStaff, safely } from '@/lib/admin-data';

export const metadata: Metadata = { title: 'Ажилтнууд' };

export default async function StaffPage() {
  const [staff, branches] = await Promise.all([safely(getStaff), safely(getBranches)]);
  if (!staff || !branches) {
    return (
      <>
        <PageHeader title="Ажилтнууд" />
        <ErrorState message="Ажилтны жагсаалтыг ачаалж чадсангүй." />
      </>
    );
  }
  return <StaffView staff={staff} branches={branches.map((b) => ({ id: b.id, name: b.name }))} />;
}
