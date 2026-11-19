/** Format an integer MNT amount, e.g. 15000 -> "₮15,000". */
export function formatMnt(amount: number): string {
  const n = Math.round(amount);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}₮${digits}`;
}

/** Bonus points earned per paid MNT (1 point = 1₮ of future value). */
export const POINTS_RATE = 0.01;

/** Points a booking that paid `total` MNT earns: floor(total x 1%). Exact for whole-MNT totals. */
export function pointsFor(total: number): number {
  return Math.floor(Math.round(total * POINTS_RATE * 100) / 100);
}
