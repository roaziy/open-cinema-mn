import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = { title: 'Шалгах' };

export default function ScanPlaceholder() {
  return (
    <>
      <PageHeader title="Билет шалгах" />
      <p className="rounded-panel border border-hairline bg-raised p-4 text-[15px] text-body">
        QR уншуулах хэсэг удахгүй нэмэгдэнэ.
      </p>
    </>
  );
}
