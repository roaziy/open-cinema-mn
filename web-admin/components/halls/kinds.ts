import type { SeatKind } from '@open-cinema/shared';

export const KIND_LABEL: Record<SeatKind, string> = {
  standard: 'Энгийн',
  premium: 'Премиум',
  wheelchair: 'Тэргэнцэр',
  blocked: 'Хаалттай',
};

/** Identity colours per seat kind (blue is reserved for the selected seat). */
export const KIND_FILL: Record<SeatKind, string> = {
  standard: '#3A3A42',
  premium: '#8B5CF6',
  wheelchair: '#38BDF8',
  blocked: '#151517',
};

export const KINDS: SeatKind[] = ['standard', 'premium', 'wheelchair', 'blocked'];

export const VIEW_LABEL = {
  very_close: 'Хэт ойр',
  angled: 'Хазгай өнцөг',
  immersive: 'Дүүрэн үзэгдэх',
  balanced: 'Тэнцвэртэй',
} as const;
