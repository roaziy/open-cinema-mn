import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { GuestNotice } from '@/components/guest/GuestNotice';
import { PaperTicket } from '@/components/guest/PaperTicket';
import { WalletButton } from '@/components/guest/WalletButton';
import { Logo } from '@/components/ui/Logo';
import { clientOf } from '@/lib/bff';
import { APP_NAME } from '@/lib/env';
import { isAppleDevice, loadGuestTickets, mapLink, walletHref } from '@/lib/guest';

// Per-guest, per-request: never prerendered, never shared.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Таны тасалбар',
  robots: { index: false, follow: false, noarchive: true },
  referrer: 'no-referrer',
};

const WALLET_NOTE: Record<string, string> = {
  off: 'Apple Wallet одоогоор идэвхгүй байна. QR кодоо хаалган дээр үзүүлнэ үү.',
  error: 'Wallet-д нэмж чадсангүй. Дахин оролдоно уу, эсвэл QR кодоо шууд үзүүлнэ үү.',
};

export default async function GuestTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ wallet?: string }>;
}) {
  const { token } = await params;
  const { wallet } = await searchParams;
  const hdrs = await headers();
  const loaded = await loadGuestTickets(token, clientOf(hdrs));
  if (loaded.kind === 'missing') notFound();
  if (loaded.kind === 'unavailable') {
    return (
      <GuestNotice title="Тасалбарыг ачаалж чадсангүй">
        <p>Сервер түр хариу өгсөнгүй. Хэдэн секундийн дараа хуудсыг дахин нээнэ үү.</p>
        <a
          href={`/t/${encodeURIComponent(token)}`}
          className="focus-ring flex h-12 items-center justify-center rounded-card bg-action text-[16px] font-semibold text-white"
        >
          Дахин оролдох
        </a>
      </GuestNotice>
    );
  }

  const { booking, tickets } = loaded.data;
  const first = tickets[0];
  const cancelled = booking.status === 'cancelled';
  const branch = booking.showtime.branch;
  const apple = isAppleDevice(hdrs.get('user-agent'));
  // `passUrl` only tells us Wallet is configured; the signed URL itself is minted at tap time.
  const walletReady = (passUrl: string | null) => apple && passUrl !== null;
  const backdrop = first?.movie.backdropUrl ?? first?.movie.posterUrl;

  return (
    <div className="relative min-h-dvh overflow-hidden">
      {backdrop && (
        // biome-ignore lint/performance/noImgElement: blurred poster backdrop from arbitrary storage hosts
        <img
          src={backdrop}
          alt=""
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 size-full scale-110 object-cover opacity-30 blur-[40px]"
        />
      )}
      <main className="mx-auto flex w-full max-w-[420px] flex-col gap-5 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={28} />
            <p className="text-[15px] font-semibold text-ink">{APP_NAME}</p>
          </div>
          <p className="text-[13px] text-body tabular-nums">{booking.orderNo}</p>
        </header>

        <section className="rounded-panel border border-hairline bg-surface/90 p-4 backdrop-blur">
          <p className="text-[13px] text-muted">Кино театр</p>
          <p className="text-[19px] font-semibold text-ink">{branch.name}</p>
          <p className="mt-0.5 text-[15px] text-body">{branch.address}</p>
          <a
            href={mapLink(branch.lat, branch.lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring mt-3 flex h-11 items-center justify-center rounded-card bg-fill text-[15px] font-semibold text-ink active:bg-white/[0.14]"
          >
            Газрын зураг дээр харах
          </a>
        </section>

        {cancelled && (
          <p
            role="status"
            className="rounded-panel border border-hue-red/30 bg-hue-red/10 p-4 text-[16px] text-ink"
          >
            Сеанс цуцлагдсан. Төлбөр буцаагдана.
          </p>
        )}
        {wallet && WALLET_NOTE[wallet] && (
          <p
            role="status"
            className="rounded-panel border border-hairline bg-raised p-4 text-[15px] text-body"
          >
            {WALLET_NOTE[wallet]}
          </p>
        )}

        {tickets.map((t) => (
          <PaperTicket
            key={t.id}
            ticket={t}
            wallet={
              walletReady(t.passUrl) ? <WalletButton href={walletHref(token, t.id)} /> : undefined
            }
          />
        ))}

        <p className="px-2 text-center text-[13px] leading-relaxed text-muted">
          QR кодыг хаалган дээр үзүүлнэ үү. Дэлгэцийн гэрлээ тод болгоорой.
        </p>
      </main>
    </div>
  );
}
