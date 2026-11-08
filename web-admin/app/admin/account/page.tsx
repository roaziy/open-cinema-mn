import type { Metadata } from 'next';
import { PasswordForm } from '@/components/account/PasswordForm';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = { title: 'Миний бүртгэл' };

export default function AccountPage() {
  return (
    <>
      <PageHeader title="Миний бүртгэл" subtitle="Нууц үг солих" />
      <PasswordForm />
    </>
  );
}
