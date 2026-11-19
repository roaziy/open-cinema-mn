/** Dark-only design tokens. See the "Visual language" section of the UI plan. */
import { HUES, type HueKey, hueFor as sharedHueFor } from '@/shared';

export const colors = {
  // Same dark palette as the Shop.mn vendor app: cards are one borderless surface on the canvas,
  // `fill` is a control sitting on a card, `hairline` only separates rows inside a card.
  canvas: '#0B0B0D',
  surface: '#1A1A1D',
  /** Kept for the call sites that named their card "raised": the same card surface. */
  raised: '#1A1A1D',
  fill: '#26262B',
  hairline: '#2C2C30',
  /** Segmented-control track and its raised thumb (Shop.mn: `line` / `raisedFill`). */
  track: '#2C2C30',
  thumb: '#3A3A40',
  /** Field edge on focus (the dark palette's own blue, 3:1+ on the field) and placeholder text. */
  focus: '#60A5FA',
  hint: '#7C7C88',

  ink: '#F5F5F7',
  body: '#C7C7CC',
  muted: '#98989F',

  /** Action blue: primary CTA, selected seat, live/selected states only. */
  action: '#2B7FFF',
  onAction: '#FFFFFF',

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
  /** Text and QR ink on paper. */
  paperInk: '#17140F',
  paperMuted: '#6B645A',
  paperRule: 'rgba(23,20,15,0.18)',
} as const;

/** Identity hues: category/identity only, never for actions. */
export const hues = HUES;

export type HueName = HueKey;

/** Stable hue for any string id (branch, hall, ...); the same color as in the admin app. */
export function hueFor(key: string): string {
  return HUES[sharedHueFor(key)];
}

/** Shop.mn vendor app radii: cards 26, fields/buttons/chips 18, tiles 12. Pair with `borderCurve: 'continuous'`. */
export const radius = { panel: 26, card: 18, inner: 12, tile: 8, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const hairlineWidth = 1;
