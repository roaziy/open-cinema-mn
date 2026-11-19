/** Price of a standard seat; premium seats cost PREMIUM_EXTRA more. */
export const PREMIUM_EXTRA = 7000;

/** Standard price: evening shows, weekend evenings and IMAX cost more. */
export function priceFor(date: string, startMin: number, imax: boolean): number {
  const weekend = [0, 5, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  if (imax || (weekend && startMin >= 17 * 60)) return 18000;
  return startMin >= 17 * 60 ? 15000 : 12000;
}

/**
 * Shows for one hall and day: first at 10:00-10:30 (UB), then each film's length plus a 20 minute
 * turnaround rounded up to 5 minutes, last start no later than 23:30. Late shows run past
 * midnight. Films rotate by hall and day so every hall does not show the same film at once.
 */
export function planDay<F extends { durationMin: number }>(
  hallIdx: number,
  dayIdx: number,
  films: readonly F[],
): { film: F; startMin: number }[] {
  const plan: { film: F; startMin: number }[] = [];
  if (films.length === 0) return plan;
  let cursor = 10 * 60 + (hallIdx % 4) * 10;
  for (let k = 0; cursor <= 23 * 60 + 30; k++) {
    const film = films[(hallIdx + dayIdx + k) % films.length] as F;
    plan.push({ film, startMin: cursor });
    cursor = Math.ceil((cursor + film.durationMin + 20) / 5) * 5;
  }
  return plan;
}
