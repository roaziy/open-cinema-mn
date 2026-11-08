/**
 * Apple's official "Add to Apple Wallet" artwork may only be used unmodified and under Apple's
 * licence, so it is never drawn here: the operator drops the file they were given at
 * `public/wallet-badge-mn.svg` and sets `WALLET_BADGE_FILE=1`. Until then this is a plain text button.
 */
const BADGE = 'wallet-badge-mn.svg';

/**
 * Set `WALLET_BADGE_FILE=1` once the file is in `public/`. It is a flag, not a file check at
 * request time, because hosts such as Vercel do not ship `public/` to the server's filesystem.
 */
const hasBadge = (): boolean => process.env.WALLET_BADGE_FILE === '1';

export function WalletButton({ href }: { href: string }) {
  const label = 'Apple Wallet-д нэмэх';
  return hasBadge() ? (
    <a href={href} className="focus-ring mx-auto mt-4 block w-fit" aria-label={label}>
      {/* biome-ignore lint/performance/noImgElement: Apple's artwork must be shown as supplied */}
      <img src={`/${BADGE}`} alt={label} height={48} className="h-12 w-auto" />
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
