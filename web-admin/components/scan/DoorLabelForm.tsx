'use client';

import { useState } from 'react';
import { cleanLabel, MAX_LABEL } from '@/lib/scan/door';

/** Names this phone's door ("Хаалга 2"); the next door that sees a repeat reads it on the card. */
export function DoorLabelForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  submitLabel: string;
  onSubmit: (label: string) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const clean = cleanLabel(value);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean) onSubmit(clean);
      }}
    >
      <label htmlFor="door-label" className="text-[16px] font-semibold text-ink">
        Энэ хаалганы нэр
      </label>
      <input
        id="door-label"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={MAX_LABEL}
        placeholder="Жишээ нь: Хаалга 1"
        autoComplete="off"
        className="focus-ring h-14 rounded-panel border border-hairline bg-surface px-4 text-[18px] text-ink placeholder:text-muted"
      />
      <div className="flex gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="focus-ring h-14 rounded-panel bg-fill px-6 text-[17px] font-semibold text-ink"
          >
            Болих
          </button>
        )}
        <button
          type="submit"
          disabled={!clean}
          className="focus-ring h-14 flex-1 rounded-panel bg-action text-[18px] font-semibold text-white disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
