/**
 * Apple's official "Add to Apple Wallet" artwork may only be used unmodified and under Apple's
 * licence, so it is never drawn or committed here: the operator hosts the file Apple gave them
 * (e.g. in their storage bucket) and sets `WALLET_BADGE_URL`. Until then this is a plain text button.
 */
const badgeUrl = (): string | undefined => process.env.WALLET_BADGE_URL || undefined;

export function WalletButton({ href }: { href: string }) {
  const label = 'Apple Wallet-д нэмэх';
  const badge = badgeUrl();
  return badge ? (
    <a href={href} className="focus-ring mx-auto mt-4 block w-fit" aria-label={label}>
      {/* biome-ignore lint/performance/noImgElement: Apple's artwork must be shown as supplied */}
      <img src={badge} alt={label} height={48} className="h-12 w-auto" />
    </a>
  ) : (
    <a
      href={href}
      className="focus-ring mt-4 flex h-12 items-center justify-center rounded-[10px] bg-[#17161a] text-[16px] font-semibold text-white active:bg-black"
    >
      {label}
    </a>
  );
}
