/**
 * The product mark: an open "O" with a play triangle, on action blue (source: docs/brand/logo.svg).
 * Decorative: it always sits next to the product name or inside a labelled link, so it carries no
 * name of its own.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="shrink-0">
      <rect width="100" height="100" rx="22" fill="#2E6BF0" />
      <path
        d="M71.3 35.1A26 26 0 1 0 71.3 64.9"
        fill="none"
        stroke="#fff"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d="M44 39 62 50 44 61Z"
        fill="#fff"
        stroke="#fff"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
