import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Apple's official "Add to Apple Wallet" artwork may only be used unmodified and under Apple's
 * licence, so it is never drawn here: the operator drops the file they were given at
 * `public/wallet-badge-mn.svg`. Until then this is a plain text button.
 */
const BADGE = 'wallet-badge-mn.svg';

function hasBadge(): boolean {
  try {
    return existsSync(join(process.cwd(), 'public', BADGE));
  } catch {
    return false;
  }
}

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
