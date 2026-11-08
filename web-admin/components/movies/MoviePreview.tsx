import { dayMonth } from '@/lib/format';
import { readableOn } from '@/lib/tone';
import type { Form } from './movieForm';

/** How the film will look in the apps: blurred poster behind it, tone as the ticket stub band. */
export function MoviePreview({ f }: { f: Form }) {
  const backdrop = f.backdropUrl || f.posterUrl;
  return (
    <aside aria-label="Урьдчилан харах" className="xl:sticky xl:top-5 xl:self-start">
      <div className="highlight relative overflow-hidden rounded-panel border border-hairline bg-canvas">
        {backdrop && (
          // biome-ignore lint/performance/noImgElement: arbitrary storage host
          <img
            src={backdrop}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full scale-125 object-cover opacity-60 blur-2xl"
          />
        )}
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative p-5">
          <div
            className="mx-auto w-[150px] overflow-hidden rounded-card border border-white/10 bg-fill"
            style={{ aspectRatio: '2 / 3' }}
          >
            {f.posterUrl && (
              // biome-ignore lint/performance/noImgElement: arbitrary storage host
              <img src={f.posterUrl} alt="" className="size-full object-cover" />
            )}
          </div>
          <p className="mt-4 text-center text-lg font-semibold text-ink">
            {f.title || 'Киноны нэр'}
          </p>
          <p className="mt-0.5 text-center text-[13px] text-body">
            {[
              f.ageRating,
              f.durationMin && `${f.durationMin} мин`,
              f.releaseDate && dayMonth(f.releaseDate),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div
            className="mt-4 flex items-center justify-between rounded-card px-3.5 py-2.5 text-[13px] font-medium"
            style={{ background: f.tone, color: readableOn(f.tone) }}
          >
            <span>Тасалбарын зурвас</span>
            <span className="tabular-nums">{f.tone.toUpperCase()}</span>
          </div>
        </div>
      </div>
      <p className="mt-2 px-1 text-xs text-muted">
        Апп дээр постер, суудлын дэлгэцийн гэрэл, тасалбарт энэ өнгө хэрэглэгдэнэ.
      </p>
    </aside>
  );
}
