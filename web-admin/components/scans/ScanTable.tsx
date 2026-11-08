import type { AdminScan } from '@open-cinema/shared';
import { clockUb } from '@/lib/format';
import { HUES, hueFor } from '@/lib/hues';
import { RESULT_TITLES, RESULT_TONES } from '@/lib/scan/card';

const TONE_CLASS = {
  admit: 'bg-hue-green/15 text-hue-green',
  neutral: 'bg-fill text-body',
  reject: 'bg-hue-red/15 text-danger',
} as const;

/** One line per scan: when, what happened, which ticket, who and where. */
export function ScanTable({ items }: { items: AdminScan[] }) {
  return (
    <div className="highlight overflow-x-auto rounded-panel border border-hairline bg-raised">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-hairline text-xs text-muted">
            <th className="px-4 py-3 font-medium">Цаг</th>
            <th className="px-4 py-3 font-medium">Үр дүн</th>
            <th className="px-4 py-3 font-medium">Тасалбар</th>
            <th className="px-4 py-3 font-medium">Ажилтан</th>
            <th className="px-4 py-3 font-medium">Салбар</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {items.map((s) => (
            <tr key={s.id}>
              <td className="px-4 py-2.5 text-ink tabular-nums">{clockUb(s.at)}</td>
              <td className="px-4 py-2.5">
                <span
                  className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium ${TONE_CLASS[RESULT_TONES[s.result]]}`}
                >
                  {RESULT_TITLES[s.result]}
                </span>
                {s.undone && <span className="ml-2 text-xs text-muted">буцаагдсан</span>}
              </td>
              <td className="px-4 py-2.5">
                {s.ticket ? (
                  <>
                    <p className="font-medium text-ink">
                      {s.ticket.movieTitle} · {s.ticket.hallName} · {s.ticket.seatCode}
                    </p>
                    <p className="text-xs text-muted tabular-nums">
                      {s.ticket.orderNo} · сеанс {clockUb(s.ticket.startsAt)}
                    </p>
                  </>
                ) : (
                  <span className="text-muted">Тасалбар таарсангүй</span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <p className="text-body">{s.staffName}</p>
                {s.deviceLabel && <p className="text-xs text-muted">{s.deviceLabel}</p>}
              </td>
              <td className="px-4 py-2.5">
                {s.branchId ? (
                  <span className="inline-flex items-center gap-2 text-body">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ background: HUES[hueFor(s.branchId)] }}
                    />
                    {s.branchName}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
