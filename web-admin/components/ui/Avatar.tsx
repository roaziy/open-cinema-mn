import { HUES, hueFor, initials } from '@/lib/hues';

/** Initials on the person's own hue. */
export function Avatar({
  seed,
  name,
  size = 32,
}: {
  seed: string;
  name: string | null;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: HUES[hueFor(seed)],
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.28)',
      }}
    >
      {initials(name)}
    </span>
  );
}
