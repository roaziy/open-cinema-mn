/** Inline message with a red status dot. Announced to screen readers when it appears. */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2.5 rounded-card border border-hue-red/25 bg-hue-red/10 px-3 py-2.5 text-[13px] leading-snug text-danger"
    >
      <span aria-hidden className="mt-[5px] size-2 shrink-0 rounded-full bg-hue-red" />
      <span>{children}</span>
    </p>
  );
}
