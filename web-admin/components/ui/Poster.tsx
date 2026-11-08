import { FilmStrip } from '@phosphor-icons/react/dist/ssr';

/** The film's own poster as imagery. A missing or broken URL falls back to a tone block. */
export function Poster({
  src,
  title,
  tone,
  className = '',
}: {
  src: string | null | undefined;
  title: string;
  tone?: string;
  className?: string;
}) {
  return (
    <span
      className={`relative block shrink-0 overflow-hidden rounded-card bg-fill ${className}`}
      style={tone ? { backgroundColor: `${tone}33` } : undefined}
    >
      <span aria-hidden className="absolute inset-0 flex items-center justify-center text-muted/60">
        <FilmStrip size={20} weight="fill" />
      </span>
      {src && (
        // biome-ignore lint/performance/noImgElement: posters come from arbitrary storage hosts
        <img
          src={src}
          alt={title}
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}
