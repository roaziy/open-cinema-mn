import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-action text-white hover:bg-action-hover',
  secondary: 'bg-fill text-ink hover:bg-white/[0.12]',
  ghost: 'text-body hover:bg-white/[0.06] hover:text-ink',
  danger: 'bg-hue-red/15 text-danger hover:bg-hue-red/25',
};

export function buttonClass(variant: Variant = 'secondary', size: 'md' | 'sm' = 'md'): string {
  const h = size === 'md' ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-[13px]';
  return `focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-card font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${h} ${VARIANT[variant]}`;
}

export function Button({
  variant,
  size,
  className = '',
  type = 'button',
  ...rest
}: { variant?: Variant; size?: 'md' | 'sm' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}
