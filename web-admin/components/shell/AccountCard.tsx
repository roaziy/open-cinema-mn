'use client';

import { Gear, SignOut } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Avatar } from '../ui/Avatar';
import { signOut } from './sign-out';

/** Who you are, which role, and the way out. */
export function AccountCard({
  id,
  name,
  detail,
  role,
  loginPath,
  accountHref,
}: {
  id: string;
  name: string;
  detail?: string | null;
  role: string;
  loginPath: '/login' | '/staff/login';
  /** Where the name leads (the account page), when there is one. */
  accountHref?: string;
}) {
  return (
    <div className="highlight flex items-center gap-2.5 rounded-card border border-hairline bg-fill p-2">
      <Avatar seed={id} name={name} size={34} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold leading-tight text-ink">{name}</p>
        <p className="truncate text-xs leading-tight text-muted">
          {role}
          {detail ? ` · ${detail}` : ''}
        </p>
      </div>
      {accountHref && (
        <Link
          href={accountHref}
          aria-label="Миний бүртгэл, нууц үг солих"
          title="Нууц үг солих"
          className="focus-ring flex size-8 items-center justify-center rounded-tile text-muted transition-colors hover:bg-white/[0.08] hover:text-ink"
        >
          <Gear size={18} />
        </Link>
      )}
      <form action={signOut.bind(null, loginPath)}>
        <button
          type="submit"
          aria-label="Гарах"
          title="Гарах"
          className="focus-ring flex size-8 items-center justify-center rounded-tile text-muted transition-colors hover:bg-white/[0.08] hover:text-ink"
        >
          <SignOut size={18} />
        </button>
      </form>
    </div>
  );
}
