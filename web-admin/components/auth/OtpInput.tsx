'use client';

import { type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';

const LENGTH = 6;

/** Six boxes that advance on their own. Submits the form once all six digits are in. */
export function OtpInput({ name, resetKey }: { name: string; resetKey: unknown }) {
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(''));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const hidden = useRef<HTMLInputElement>(null);

  // A rejected code clears the boxes and puts the cursor back at the start.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the result changes
  useEffect(() => {
    setDigits(Array(LENGTH).fill(''));
    refs.current[0]?.focus();
  }, [resetKey]);

  const commit = (next: string[]) => {
    setDigits(next);
    if (next.every(Boolean)) {
      // The hidden input is updated by React after this tick; submit once it has the value.
      queueMicrotask(() => hidden.current?.form?.requestSubmit());
    }
  };

  const put = (index: number, raw: string) => {
    const incoming = raw.replace(/\D/g, '');
    if (!incoming) return;
    const next = [...digits];
    let i = index;
    for (const ch of incoming) {
      if (i >= LENGTH) break;
      next[i++] = ch;
    }
    commit(next);
    refs.current[Math.min(i, LENGTH - 1)]?.focus();
  };

  const onKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = '';
      setDigits(next);
      refs.current[index - 1]?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    else if (e.key === 'ArrowRight' && index < LENGTH - 1) refs.current[index + 1]?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    put(0, e.clipboardData.getData('text'));
  };

  return (
    <fieldset className="m-0 flex min-w-0 gap-2 border-0 p-0">
      <legend className="sr-only">6 оронтой код</legend>
      <input ref={hidden} type="hidden" name={name} value={digits.join('')} />
      {digits.map((d, i) => (
        <input
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed six positions
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          onChange={(e) => put(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={LENGTH}
          aria-label={`${i + 1}-р орон`}
          className="focus-ring h-14 min-w-0 flex-1 rounded-card border border-hairline bg-raised text-center text-[22px] font-semibold text-ink transition-colors focus:border-action/70"
        />
      ))}
    </fieldset>
  );
}
