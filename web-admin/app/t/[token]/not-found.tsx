import type { Metadata } from 'next';
import { GuestNotice } from '@/components/guest/GuestNotice';

export const metadata: Metadata = {
  title: 'Холбоос хүчингүй',
  robots: { index: false, follow: false },
};

export default function InvalidLink() {
  return (
    <GuestNotice title="Холбоос хүчингүй байна">
      <p>Тасалбарын холбоос буруу эсвэл дутуу хуулагдсан байна.</p>
      <p>
        Имэйлээр ирсэн холбоосыг бүтнээр нь дахин нээнэ үү. Олдохгүй бол захиалгын дугаараа бэлдээд
        кино театрын ажилтанд хандана уу.
      </p>
    </GuestNotice>
  );
}
