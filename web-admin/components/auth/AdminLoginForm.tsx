'use client';

import { useActionState } from 'react';
import { adminLogin, type LoginState } from '@/app/login/actions';
import { Field } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { SubmitButton } from '../ui/SubmitButton';

export function AdminLoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action] = useActionState<LoginState, FormData>(adminLogin, {});
  const message = state.error ?? notice;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      {message && <Notice>{message}</Notice>}
      <Field
        id="email"
        label="Имэйл"
        type="email"
        autoComplete="username"
        inputMode="email"
        defaultValue={state.email}
        placeholder="admin@example.com"
        required
      />
      <Field
        id="password"
        label="Нууц үг"
        type="password"
        autoComplete="current-password"
        required
      />
      <SubmitButton pending="Нэвтэрч байна…">Нэвтрэх</SubmitButton>
    </form>
  );
}
