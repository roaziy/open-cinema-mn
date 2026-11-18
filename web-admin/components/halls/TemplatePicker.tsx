'use client';

import { HALL_TEMPLATES, type HallTemplate } from '@/lib/shared';

/** One click fills a new hall with a common shape; everything stays editable afterwards. */
export function TemplatePicker({ onPick }: { onPick: (t: HallTemplate) => void }) {
  return (
    <section className="highlight space-y-3 rounded-panel border border-hairline bg-raised p-4">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">Бэлэн загвар</h2>
        <p className="text-xs text-muted">Сонгоод дараа нь хүссэнээрээ засна.</p>
      </div>
      <div className="grid gap-2">
        {HALL_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t)}
            className="focus-ring flex items-center justify-between rounded-card border border-hairline px-3 py-2 text-left transition-colors hover:border-white/20"
          >
            <span className="text-[13px] font-medium text-ink">{t.name}</span>
            <span className="text-xs text-muted tabular-nums">
              {t.gen.rows}×{t.gen.seatsPerRow} · {t.gen.rows * t.gen.seatsPerRow} суудал
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
