import Link from 'next/link';

/** Link-driven segmented control: the URL is the state, so it survives refresh and sharing. */
export function Tabs({
  items,
  active,
  label,
}: {
  items: { key: string; label: string; href: string }[];
  active: string;
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="inline-flex rounded-card border border-hairline bg-canvas p-0.5"
    >
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === active ? 'page' : undefined}
          className={`focus-ring rounded-[8px] px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
            i.key === active ? 'bg-fill text-ink' : 'text-muted hover:text-ink'
          }`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
