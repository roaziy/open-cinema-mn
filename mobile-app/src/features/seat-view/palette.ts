import { colors, hues } from '@/theme/tokens';

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

/** Mix two #rrggbb colours: `amount` 0 is `a`, 1 is `b`. */
function mix(a: string, b: string, amount: number): string {
  const na = Number.parseInt(a.slice(1), 16);
  const nb = Number.parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const va = (na >> shift) & 255;
    const vb = (nb >> shift) & 255;
    return Math.round(va + (vb - va) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** Every colour the 3D scene and the 2D diagram use, derived from the app tokens. */
export const palette = {
  canvas: colors.canvas,
  floor: '#2B2B32',
  seat: colors.fill,
  /** Premium seats lean indigo (the 2D map's stripe colour); taken ones are the map's near-black. */
  seatPremium: mix(colors.fill, hues.indigo, 0.4),
  seatTaken: '#101012',
  /** The seat model up close: red velvet, indigo for premium, worn dark for taken; dark shells. */
  seatFabric: '#56121A',
  seatFabricPremium: '#26285E',
  seatFabricTaken: '#1E1214',
  seatShell: '#17171C',
  chosen: colors.action,
  ambient: colors.muted,
  fill: colors.fill,
  /** 2D diagram: floor, seats. */
  diagramFloor: colors.fill,
  diagramSeat: lift(colors.fill, 0.08),
} as const;
