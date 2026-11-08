import type { InputHTMLAttributes } from 'react';

export const inputClass =
  'focus-ring h-11 w-full rounded-card border border-hairline bg-raised px-3.5 text-[15px] text-ink placeholder:text-muted/70 transition-colors hover:border-white/15 focus:border-action/70';

export function Field({
  label,
  id,
  hint,
  ...input
}: { label: string; id: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-body">
        {label}
      </label>
      <input id={id} name={id} className={inputClass} {...input} />
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
