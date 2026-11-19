import { Calendar, ChartColumn, QrCode } from 'lucide-react';
import type { ReactNode } from 'react';
import { APP_NAME } from '@/lib/env';
import { Logo } from '../ui/Logo';

const POINTS = [
  {
    icon: Calendar,
    title: 'Өнөөдрийн сеанс',
    text: 'Заал бүрийн хуваарь, зарагдсан суудал',
  },
  {
    icon: QrCode,
    title: 'Хаалганы шалгалт',
    text: 'Билетийг утсаар уншуулж нэвтрүүлнэ',
  },
  { icon: ChartColumn, title: 'Борлуулалтын тайлан', text: 'Өдөр, кино, заалаар' },
] as const;

/** Two layers: a brand rail on wide screens, and the sign-in panel. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section className="highlight hidden flex-col justify-between rounded-rail border border-hairline bg-surface p-8 lg:flex">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <span className="text-lg font-semibold text-ink">{APP_NAME}</span>
        </div>
        <div>
          <h2 className="max-w-md text-[34px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink">
            Танхимын өдөр нэг дор харагдана
          </h2>
          <ul className="mt-8 flex max-w-md flex-col gap-4">
            {POINTS.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.title} className="flex items-start gap-3">
                  <Icon
                    size={20}
                    strokeWidth={1.75}
                    className="mt-0.5 shrink-0 text-muted"
                    aria-hidden
                  />
                  <div>
                    <p className="text-sm font-medium text-ink">{p.title}</p>
                    <p className="text-[13px] text-muted">{p.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-xs text-muted">Нээлттэй эхийн кино театрын систем</p>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Logo size={32} />
            <span className="text-[17px] font-semibold text-ink">{APP_NAME}</span>
          </div>
          <div className="highlight rounded-panel border border-hairline bg-surface p-6 sm:p-7">
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}

const LOGIN_NOTICES: Record<string, string> = {
  expired: 'Нэвтэрсэн хугацаа дууссан байна. Дахин нэвтэрнэ үү.',
  forbidden: 'Энэ хэсэгт орох эрх таньд алга.',
  unavailable: 'Серверт холбогдож чадсангүй. Түр хүлээгээд дахин оролдоно уу.',
};

/** Message for the `?error=` code in the URL, only for codes we know (never reflects input). */
export function noticeFor(code: string | undefined): string | undefined {
  return code && Object.hasOwn(LOGIN_NOTICES, code) ? LOGIN_NOTICES[code] : undefined;
}
