import type { SeatKind } from '@open-cinema/shared';

export const KIND_LABEL: Record<SeatKind, string> = {
  standard: 'Энгийн',
  premium: 'Премиум',
  wheelchair: 'Тэргэнцэр',
  blocked: 'Хаалттай',
};

/** Identity colours per seat kind (blue is reserved for the selected seat). */
export const KIND_FILL: Record<SeatKind, string> = {
  standard: 'var(--color-seat)',
  premium: 'var(--color-hue-purple)',
  wheelchair: 'var(--color-hue-sky)',
  blocked: 'var(--color-surface)',
};

export const KINDS: SeatKind[] = ['standard', 'premium', 'wheelchair', 'blocked'];

export const VIEW_LABEL = {
  very_close: 'Хэт ойр',
  angled: 'Хазгай өнцөг',
  immersive: 'Дүүрэн үзэгдэх',
  balanced: 'Тэнцвэртэй',
} as const;
