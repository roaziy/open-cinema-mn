import type { Metadata } from 'next';
import { Scanner } from '@/components/scan/Scanner';

export const metadata: Metadata = { title: 'Билет шалгах' };

export default function ScanPage() {
  return <Scanner />;
}
