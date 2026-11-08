/**
 * The product mark: a ticket with a perforation, on action blue. Decorative: it always sits next
 * to the product name or inside a labelled link, so it carries no name of its own.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <rect width="64" height="64" rx="16" fill="#2E6BF0" />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M16 22a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v5.2a4.8 4.8 0 0 0 0 9.6V42a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4v-5.2a4.8 4.8 0 0 0 0-9.6V22Z"
      />
      <path d="M40 21v22" stroke="#2E6BF0" strokeWidth="2.4" strokeDasharray="3 3.2" />
    </svg>
  );
}
