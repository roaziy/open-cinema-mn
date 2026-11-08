/** Dark-only design tokens. See the "Visual language" section of the UI plan. */

export const colors = {
  canvas: '#0B0B0D',
  surface: '#151517',
  raised: '#1D1D21',
  fill: '#26262B',
  hairline: 'rgba(255,255,255,0.07)',
  highlight: 'rgba(255,255,255,0.05)',

  ink: '#F5F5F7',
  body: '#C7C7CC',
  muted: '#8E8E93',

  /** Action blue: primary CTA, selected seat, live/selected states only. */
  action: '#2E6BF0',
  onAction: '#FFFFFF',
  /** Glyph colour on identity-hue tiles. */
  tileGlyph: '#FFFFFF',

  success: '#34D399',
  danger: '#F87171',
  warning: '#FBBF24',

  /** Translucent chrome over blurred posters (chips, back button). */
  scrim: 'rgba(11,11,13,0.55)',
  scrimBorder: 'rgba(255,255,255,0.14)',
  /** Quiet chip fill and edge (age badge, pager pips). */
  chipFill: 'rgba(255,255,255,0.12)',
  chipBorder: 'rgba(255,255,255,0.18)',
  pip: 'rgba(255,255,255,0.25)',
  /** Secondary text on the action blue. */
  onActionMuted: 'rgba(255,255,255,0.85)',
  warningTint: 'rgba(251,191,36,0.45)',
  dangerFill: 'rgba(248,113,113,0.16)',
  dangerEdge: 'rgba(248,113,113,0.4)',

  /** The single light surface in the app (ticket stub / QR). */
  paper: '#F2EDE4',
} as const;

/** Identity hues: category/identity only, never for actions. */
export const hues = {
  green: '#30C46B',
  red: '#FF5A5F',
  purple: '#8B5CF6',
  teal: '#14B8A6',
  yellow: '#F5C542',
  pink: '#EC4899',
  indigo: '#5B6CFF',
  sky: '#38BDF8',
} as const;

export type HueName = keyof typeof hues;

const HUE_ORDER = Object.keys(hues) as HueName[];

/** Stable hue for any string id (branch, hall, ...). */
export function hueFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return hues[HUE_ORDER[h % HUE_ORDER.length] as HueName];
}

/** Layered depth: panel -> card -> row, each one step in. Nested radius = outer - padding. */
export const radius = { panel: 20, card: 16, inner: 10, tile: 8, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const hairlineWidth = 1;
