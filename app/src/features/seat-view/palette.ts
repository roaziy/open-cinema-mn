import { colors } from '@/theme/tokens';

/** Mix a #rrggbb colour toward white by `amount` (0..1). */
function lift(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.round(v + (255 - v) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** Every colour the 3D scene and the 2D diagram use, derived from the app tokens. */
export const palette = {
  canvas: colors.canvas,
  floor: colors.raised,
  wallSide: colors.fill,
  wallFront: colors.surface,
  seat: colors.fill,
  seatPremium: lift(colors.fill, 0.1),
  chosen: colors.action,
  ambient: colors.muted,
  fill: colors.fill,
  /** 2D diagram: floor, seats. */
  diagramFloor: colors.fill,
  diagramSeat: lift(colors.fill, 0.08),
} as const;
