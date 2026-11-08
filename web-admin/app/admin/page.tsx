import { CalendarBlank, QrCode, Ticket } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import { IconTile } from '@/components/ui/IconTile';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireRole } from '@/lib/session';
import { loadAdminShellData } from '@/lib/shell-data';

export const metadata: Metadata = { title: 'Хяналтын самбар' };

export default async function AdminHome() {
  const user = await requireRole('admin');
  const { today, branches } = await loadAdminShellData();
  const stats = [
    { label: 'Өнөөдрийн сеанс', value: today.showtimes, hue: 'green', icon: CalendarBlank },
    { label: 'Зарагдсан суудал', value: today.sold, hue: 'purple', icon: Ticket },
    { label: 'Орсон үзэгч', value: today.admitted, hue: 'teal', icon: QrCode },
  ] as const;

  return (
    <>
      <PageHeader
        title={`Сайн байна уу${user.name ? `, ${user.name}` : ''}`}
        subtitle={`Өнөөдөр ${branches.length} салбарт ${today.showtimes} сеанс товлогдсон.`}
      />
      <section aria-label="Өнөөдрийн тоо" className="grid gap-3 sm:grid-cols-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="highlight rounded-panel border border-hairline bg-raised p-4"
            >
              <IconTile hue={s.hue} size={30}>
                <Icon size={18} weight="fill" />
              </IconTile>
              <p className="mt-4 text-[32px] font-semibold leading-none text-ink tabular-nums">
                {s.value}
              </p>
              <p className="mt-1.5 text-sm text-muted">{s.label}</p>
            </div>
          );
        })}
      </section>
    </>
  );
}
