'use client';

import { TONE_PRESETS } from '@/lib/tone';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Swatches, a native color input and a hex field. `suggested` marks an auto-picked value. */
export function ToneField({
  value,
  onChange,
  suggested,
}: {
  value: string;
  onChange: (hex: string) => void;
  suggested: boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium text-body">Киноны өнгө</legend>
      <div className="flex flex-wrap items-center gap-2">
        {TONE_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`Өнгө ${c}`}
            aria-pressed={value.toUpperCase() === c}
            className="focus-ring size-7 rounded-full border border-white/10 transition-transform hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-white aria-pressed:ring-offset-2 aria-pressed:ring-offset-surface"
            style={{ background: c }}
          />
        ))}
        <label className="focus-ring relative ml-1 flex h-7 cursor-pointer items-center rounded-full border border-hairline bg-raised pl-1 pr-3 text-xs text-body hover:border-white/20">
          <input
            type="color"
            value={HEX.test(value) ? value : '#2E6BF0'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="mr-2 size-5 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
            aria-label="Өнгө сонгох"
          />
          Өөр өнгө
        </label>
        <input
          aria-label="Өнгөний код"
          value={value}
          onChange={(e) =>
            onChange(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)
          }
          maxLength={7}
          spellCheck={false}
          className="focus-ring h-7 w-[88px] rounded-full border border-hairline bg-raised px-3 text-xs uppercase text-body tabular-nums"
        />
      </div>
      {suggested && (
        <p className="mt-1.5 text-xs text-muted">
          Постерын ноёлох өнгөөс санал болгосон. Өөрчилж болно.
        </p>
      )}
    </fieldset>
  );
}
