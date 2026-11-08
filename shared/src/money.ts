/** Format an integer MNT amount, e.g. 15000 -> "₮15,000". */
export function formatMnt(amount: number): string {
  const n = Math.round(amount);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}₮${digits}`;
}
