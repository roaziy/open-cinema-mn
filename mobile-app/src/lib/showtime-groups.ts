import type { BranchShowtimes } from '@/shared';

/** Branches that have shows, the preferred one first; the rest keep the API order. */
export function groupByBranch(
  list: BranchShowtimes[],
  preferred: string | null,
): BranchShowtimes[] {
  return list
    .filter((b) => b.showtimes.length > 0)
    .map((b, i) => ({ b, i }))
    .sort((x, y) => {
      const d = Number(y.b.branch.id === preferred) - Number(x.b.branch.id === preferred);
      return d !== 0 ? d : x.i - y.i;
    })
    .map(({ b }) => b);
}
