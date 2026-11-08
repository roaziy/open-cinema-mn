import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell, LOGIN_NOTICES } from '@/components/auth/AuthShell';
import { StaffLoginForm } from '@/components/auth/StaffLoginForm';
import { safeNext } from '@/lib/auth/redirects';

export const metadata: Metadata = { title: 'Ажилтан нэвтрэх' };

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <AuthShell>
      <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-ink">Ажилтан нэвтрэх</h1>
      <p className="mb-6 mt-1.5 text-[15px] text-muted">
        Утасныхаа дугаарыг оруулаад кодоор нэвтэрнэ.
      </p>
      <StaffLoginForm
        next={safeNext(next, '/staff')}
        notice={error ? LOGIN_NOTICES[error] : undefined}
      />
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
