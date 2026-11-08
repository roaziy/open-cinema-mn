import type { Metadata } from 'next';
import Link from 'next/link';
import { RedirectType, redirect } from 'next/navigation';
import { AuthShell, noticeFor } from '@/components/auth/AuthShell';
import { EndSession } from '@/components/auth/EndSession';
import { StaffLoginForm } from '@/components/auth/StaffLoginForm';
import { safeNext } from '@/lib/auth/redirects';
import { verdictFor } from '@/lib/auth/verdict';

export const metadata: Metadata = { title: 'Ажилтан нэвтрэх' };

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  // A session is ended only on proof (see judgeSession); a healthy one just goes home.
  let endStale = false;
  if (error === 'expired' || error === 'forbidden') {
    const { verdict, home } = await verdictFor();
    if (verdict === 'home' && home) redirect(home, RedirectType.replace);
    endStale = verdict === 'end';
  }
  return (
    <AuthShell>
      {endStale ? <EndSession /> : null}
      <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-ink">Ажилтан нэвтрэх</h1>
      <p className="mb-6 mt-1.5 text-[15px] text-muted">
        Утасныхаа дугаарыг оруулаад кодоор нэвтэрнэ.
      </p>
      <StaffLoginForm next={safeNext(next, '/staff')} notice={noticeFor(error)} />
      <p className="mt-8 text-sm text-muted">
        Админ уу?{' '}
        <Link
          href="/login"
          className="focus-ring rounded font-medium text-ink underline decoration-white/25 underline-offset-4 hover:decoration-white/60"
        >
          Имэйлээр нэвтрэх
        </Link>
      </p>
    </AuthShell>
  );
}
