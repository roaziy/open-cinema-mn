'use client';

import { useEffect, useRef, useState } from 'react';

/** For a dirty lens or a cracked screen: paste or type the ticket code instead of scanning it. */
export function ManualEntry({
  onSubmit,
  onClose,
}: {
  onSubmit: (token: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const clean = code.trim();
  return (
    <form
      className="animate-rise absolute inset-x-0 bottom-0 z-30 flex flex-col gap-3 rounded-t-rail border-t border-hairline bg-raised px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean) onSubmit(clean);
      }}
    >
      <label htmlFor="manual-code" className="text-[18px] font-semibold text-ink">
        Кодыг гараар оруулах
      </label>
      <textarea
        id="manual-code"
        ref={ref}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={3}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        placeholder="Тасалбарын кодыг энд буулгана уу"
        className="focus-ring w-full resize-none rounded-panel border border-hairline bg-surface p-3.5 font-mono text-[15px] break-all text-ink placeholder:text-muted"
      />
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="focus-ring h-14 rounded-panel bg-fill px-6 text-[17px] font-semibold text-ink"
        >
          Болих
        </button>
        <button
          type="submit"
          disabled={!clean}
          className="focus-ring h-14 flex-1 rounded-panel bg-action text-[17px] font-semibold text-white disabled:opacity-50"
        >
          Шалгах
        </button>
      </div>
    </form>
  );
}
