import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HallEditor } from '@/components/halls/HallEditor';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getBranches, getHall, safely } from '@/lib/admin-data';

export const metadata: Metadata = { title: 'Заалны тохиргоо' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ branch?: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function HallPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { branch } = await searchParams;
  const isNew = id === 'new';
  if (!isNew && !UUID.test(id)) notFound();

  const [branches, hall] = await Promise.all([
    safely(getBranches),
    isNew ? Promise.resolve(null) : safely(() => getHall(id)),
  ]);
  const title = isNew ? 'Шинэ заал' : (hall?.name ?? 'Заал');
  if (!branches || (!isNew && !hall)) {
    return (
      <>
        <PageHeader title={title} />
        <ErrorState message="Заалын мэдээллийг ачаалж чадсангүй." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          isNew
            ? 'Параметр өөрчлөхөд суудлын зураг шууд шинэчлэгдэнэ'
            : `${branches.find((b) => b.id === hall?.branchId)?.name ?? ''} · ${hall?.seatCount ?? 0} суудал`
        }
      />
      <HallEditor
        key={hall?.id ?? 'new'}
        hall={hall}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        defaultBranchId={branch}
      />
    </>
  );
}
