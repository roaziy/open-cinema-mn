'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/** Action-blue primary button that locks itself while its form is submitting. */
export function SubmitButton({
  children,
  pending: busy,
}: {
  children: ReactNode;
  pending?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="focus-ring flex h-11 w-full items-center justify-center rounded-card bg-action text-[15px] font-semibold text-white transition-colors hover:bg-action-hover disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? (busy ?? 'Түр хүлээнэ үү…') : children}
    </button>
  );
}
