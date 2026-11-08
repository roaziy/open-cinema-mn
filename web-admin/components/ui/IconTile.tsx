import type { ReactNode } from 'react';
import { HUES, type HueKey } from '@/lib/hues';

/** Filled identity-hue tile holding a white filled glyph (the iOS Settings pattern). */
export function IconTile({
  hue,
  size = 26,
  children,
  className = '',
}: {
  hue: HueKey;
  size?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-tile text-white ${className}`}
      style={{
        width: size,
        height: size,
        background: HUES[hue],
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.28), inset 0 -1px 0 rgb(0 0 0 / 0.12)',
      }}
    >
      {children}
    </span>
  );
}
