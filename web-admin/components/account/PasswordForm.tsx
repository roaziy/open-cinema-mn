'use client';

import { useActionState } from 'react';
import { changePassword, type PasswordState } from '@/app/admin/account/actions';
import { Field } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { SubmitButton } from '../ui/SubmitButton';

export function PasswordForm() {
  const [state, action] = useActionState<PasswordState, FormData>(changePassword, {});
  return (
    <form action={action} className="flex max-w-sm flex-col gap-4">
      {state.error && <Notice>{state.error}</Notice>}
      {state.done && (
        <p
          role="status"
          className="rounded-card border border-hue-green/25 bg-hue-green/10 px-3 py-2.5 text-[13px] text-ink"
        >
          Нууц үг солигдлоо. Бусад төхөөрөмжөөс гарсан.
        </p>
      )}
      <Field
        id="current"
        label="Одоогийн нууц үг"
        type="password"
        autoComplete="current-password"
        required
      />
      <Field
        id="next"
        label="Шинэ нууц үг"
        type="password"
        autoComplete="new-password"
        minLength={8}
        hint="Дор хаяж 8 тэмдэгт."
        required
      />
      <Field
        id="repeat"
        label="Шинэ нууц үг давтах"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <SubmitButton pending="Хадгалж байна…">Нууц үг солих</SubmitButton>
    </form>
  );
}
