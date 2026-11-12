import type { ScanResult } from '@/lib/shared';

export type RecentScan = { result: ScanResult; undone: boolean };

/**
 * The server lists an undone admit twice: the admit (its `undoUntil` cleared) and the separate
 * `undone` row. On screen it is one chip, shown as undone, matching what the strip does live.
 */
export function mapRecent(list: ScanResult[]): RecentScan[] {
  return list
    .filter((r) => r.result !== 'undone')
    .map((result) => ({
      result,
      undone: result.result === 'admitted' && result.undoUntil === null,
    }));
}
