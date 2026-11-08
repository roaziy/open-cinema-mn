import 'server-only';
import { BranchSchema } from '@open-cinema/shared';
import { unstable_rethrow } from 'next/navigation';
import { cache } from 'react';
import { z } from 'zod';
import { apiGet } from './api';
import { type HueKey, hueFor } from './hues';
import { type TodayShowtime, TodayShowtimeSchema } from './schemas';

export type ShellBranch = {
  id: string;
  name: string;
  hue: HueKey;
  /** Showtimes today at this branch. */
  showtimes: number;
  /** A show is about to start here and nobody has been scanned in yet. */
  attention: boolean;
};

export type ShellData = {
  /** The numbers could not be loaded. Zeros here would be a lie, so the UI shows a marker. */
  failed: boolean;
  branches: ShellBranch[];
  today: {
    showtimes: number;
    admitted: number;
    sold: number;
    capacity: number;
    attention: boolean;
  };
};

const SOON_MS = 30 * 60 * 1000;

/** Sold seats, doors about to open, nobody through yet. */
function needsAttention(rows: TodayShowtime[], now: number): boolean {
  return rows.some((r) => {
    const until = new Date(r.startsAt).getTime() - now;
    return until > 0 && until <= SOON_MS && r.sold > 0 && r.admitted === 0;
  });
}

const EMPTY: ShellData = {
  failed: true,
  branches: [],
  today: { showtimes: 0, admitted: 0, sold: 0, capacity: 0, attention: false },
};

/**
 * Numbers for the admin sidebar. A failing call must not take the whole shell down, so an error
 * degrades to `failed: true` (shown as a quiet marker) instead of an error page or fake zeros.
 */
export const loadAdminShellData = cache(async (): Promise<ShellData> => {
  try {
    const branches = await apiGet('/branches', z.array(BranchSchema));
    const perBranch = await Promise.all(
      branches.map((b) =>
        apiGet(`/staff/today?branchId=${encodeURIComponent(b.id)}`, z.array(TodayShowtimeSchema)),
      ),
    );
    const now = Date.now();
    const all = perBranch.flat();
    return {
      failed: false,
      branches: branches.map((b, i) => {
        const rows = perBranch[i] ?? [];
        return {
          id: b.id,
          name: b.name,
          hue: hueFor(b.id),
          showtimes: rows.length,
          attention: needsAttention(rows, now),
        };
      }),
      today: {
        showtimes: all.length,
        admitted: all.reduce((n, r) => n + r.admitted, 0),
        sold: all.reduce((n, r) => n + r.sold, 0),
        capacity: all.reduce((n, r) => n + r.capacity, 0),
        attention: needsAttention(all, now),
      },
    };
  } catch (err) {
    // apiFetch signals redirects by throwing; those must keep propagating.
    unstable_rethrow(err);
    return EMPTY;
  }
});
