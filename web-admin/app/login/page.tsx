import type { Metadata } from 'next';
import Link from 'next/link';
import { RedirectType, redirect } from 'next/navigation';
import { AdminLoginForm } from '@/components/auth/AdminLoginForm';
import { AuthShell, noticeFor } from '@/components/auth/AuthShell';
import { EndSession } from '@/components/auth/EndSession';
import { safeNext } from '@/lib/auth/redirects';
import { verdictFor } from '@/lib/auth/verdict';

export const metadata: Metadata = { title: 'Админ нэвтрэх' };

export default async function LoginPage({
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
      <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-ink">Админ нэвтрэх</h1>
      <p className="mb-6 mt-1.5 text-[15px] text-muted">Имэйл, нууц үгээрээ нэвтэрнэ үү.</p>
      <AdminLoginForm next={safeNext(next, '/admin')} notice={noticeFor(error)} />
      <p className="mt-8 text-sm text-muted">
        Ажилтан уу?{' '}
        <Link
          href="/staff/login"
          className="focus-ring rounded font-medium text-ink underline decoration-white/25 underline-offset-4 hover:decoration-white/60"
        >
          Утасны дугаараар нэвтрэх
        </Link>
      </p>
    </AuthShell>
  );
}
