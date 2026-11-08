'use client';

import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import { useActionState, useEffect, useState } from 'react';
import {
  type RequestState,
  requestOtp,
  type VerifyState,
  verifyOtp,
} from '@/app/staff/login/actions';
import { inputClass } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { SubmitButton } from '../ui/SubmitButton';
import { OtpInput } from './OtpInput';

/** Seconds left until a new code may be requested, counted down from a server-given duration. */
function useCountdown(state: RequestState): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!state.ok || !state.retryAfterSec) {
      setLeft(0);
      return;
    }
    const total = state.retryAfterSec;
    const started = performance.now();
    const tick = () =>
      setLeft(Math.max(0, total - Math.floor((performance.now() - started) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state]);
  return left;
}

export function StaffLoginForm({ next, notice }: { next: string; notice?: string }) {
  const [sent, send] = useActionState<RequestState, FormData>(requestOtp, {});
  const [checked, verify] = useActionState<VerifyState, FormData>(verifyOtp, {});
  const [editing, setEditing] = useState(false);
  // The send result a wrong-code message belongs to: a fresh code makes that message stale.
  const [errorFor, setErrorFor] = useState<RequestState | null>(null);
  const left = useCountdown(sent);

  // A fresh code was sent: leave the phone step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the send result
  useEffect(() => setEditing(false), [sent]);

  const onCodeStep = Boolean(sent.ok && sent.phone) && !editing;
  const verifyError = checked.error && errorFor === sent ? checked.error : undefined;

  if (!onCodeStep) {
    return (
      <form action={send} className="flex flex-col gap-4">
        {(sent.error || notice) && <Notice>{sent.error ?? notice}</Notice>}
        <div>
          <label htmlFor="phone" className="mb-1.5 block text-[13px] font-medium text-body">
            Утасны дугаар
          </label>
          <div className="flex gap-2">
            <span className="flex h-11 items-center rounded-card border border-hairline bg-fill px-3 text-[15px] text-body">
              +976
            </span>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="8800 0001"
              defaultValue={sent.phone?.replace('+976', '')}
              required
              className={inputClass}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">Танд SMS-ээр 6 оронтой код очно.</p>
        </div>
        <SubmitButton pending="Илгээж байна…">Код авах</SubmitButton>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        action={(data) => {
          setErrorFor(sent);
          verify(data);
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="phone" value={sent.phone} />
        <input type="hidden" name="next" value={next} />
        {verifyError && <Notice>{verifyError}</Notice>}
        <div>
          <p className="mb-2.5 text-[13px] font-medium text-body">
            <span className="tabular-nums">{sent.phone}</span> дугаарт очсон код
          </p>
          <OtpInput name="code" resetKey={checked} />
        </div>
        <SubmitButton pending="Шалгаж байна…">Нэвтрэх</SubmitButton>
      </form>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="focus-ring -ml-1 inline-flex items-center gap-1.5 rounded px-1 text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} /> Дугаар солих
        </button>
        <form action={send}>
          <input type="hidden" name="phone" value={sent.phone} />
          <button
            type="submit"
            disabled={left > 0}
            className="focus-ring rounded px-1 font-medium text-ink transition-colors enabled:hover:text-action-hover disabled:text-muted"
          >
            {left > 0 ? `Дахин авах (${left}с)` : 'Код дахин авах'}
          </button>
        </form>
      </div>
      {sent.error && <Notice>{sent.error}</Notice>}
    </div>
  );
}
