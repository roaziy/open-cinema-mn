import {
  type Hold,
  HoldSchema,
  type SeatMap,
  SeatMapSchema,
  type SeatState,
} from '@open-cinema/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TKey } from '@/i18n';
import { ApiError, api } from './api';
import { ensureGuest, useAuth } from './auth';
import { haptic } from './haptics';
import { showToast } from './toast';

export const MAX_SEATS = 10;
const HOLD_MS = 10 * 60_000;

export const seatKeys = {
  map: (showtimeId: string) => ['seatmap', showtimeId] as const,
  /** Holds belong to one identity; the user id is part of the key. */
  holds: (showtimeId: string, userId: string | null) => ['holds', showtimeId, userId] as const,
};

export function useSeatMap(showtimeId: string) {
  return useQuery({
    queryKey: seatKeys.map(showtimeId),
    // Public: browsing a seat map must not create a guest. The first hold does.
    queryFn: async (): Promise<SeatMap> =>
      SeatMapSchema.parse(await api(`/showtimes/${showtimeId}`, { auth: false })),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

const holdList = HoldSchema.array();

export function useMyHolds(showtimeId: string) {
  const { ready, user } = useAuth();
  return useQuery({
    queryKey: seatKeys.holds(showtimeId, user?.id ?? null),
    queryFn: async (): Promise<Hold[]> =>
      holdList.parse(await api(`/showtimes/${showtimeId}/holds/mine`)),
    enabled: ready && !!user,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

/** Holds that have not run out yet. */
export function liveHolds(holds: Hold[] | undefined, now = Date.now()): Hold[] {
  return (holds ?? []).filter((h) => new Date(h.expiresAt).getTime() > now);
}

/**
 * Tap-to-hold and tap-to-release for one showtime. The change shows at once and rolls
 * back if the server refuses. A seat with a request in flight ignores further taps, and
 * the list is only re-read from the server when nothing is in flight.
 */
export function useSeatActions(showtimeId: string, t: (key: TKey) => string) {
  const qc = useQueryClient();
  const pending = useRef(new Set<string>());

  return useCallback(
    async (seatId: string) => {
      if (pending.current.has(seatId)) return;
      pending.current.add(seatId);
      let key: ReturnType<typeof seatKeys.holds> | null = null;
      try {
        const user = await ensureGuest();
        key = seatKeys.holds(showtimeId, user.id);
        const holdsKey = key;
        const read = () => liveHolds(qc.getQueryData<Hold[]>(holdsKey));
        const mine = read().find((h) => h.seatId === seatId);

        if (mine) {
          haptic.select();
          qc.setQueryData<Hold[]>(holdsKey, (cur) =>
            (cur ?? []).filter((h) => h.seatId !== seatId),
          );
          try {
            await api<void>(`/holds/${mine.id}`, { method: 'DELETE' });
          } catch (e) {
            // Already gone (expired) is the outcome we wanted; anything else comes back.
            if (!(e instanceof ApiError && e.status === 404)) {
              qc.setQueryData<Hold[]>(holdsKey, (cur) => [...(cur ?? []), mine]);
              haptic.error();
              showToast(t('seats.failedToast'), 'error');
            }
          }
          return;
        }

        if (read().length >= MAX_SEATS) {
          haptic.error();
          showToast(t('seats.maxToast'), 'error');
          return;
        }
        haptic.select();
        const optimistic: Hold = {
          id: `tmp-${seatId}`,
          seatId,
          showtimeId,
          expiresAt: new Date(Date.now() + HOLD_MS).toISOString(),
        };
        qc.setQueryData<Hold[]>(holdsKey, (cur) => [...(cur ?? []), optimistic]);
        try {
          const res = holdList.parse(
            (
              await api<{ holds: unknown }>(`/showtimes/${showtimeId}/holds`, {
                method: 'POST',
                json: { seatIds: [seatId] },
              })
            ).holds,
          );
          qc.setQueryData<Hold[]>(holdsKey, (cur) => [
            ...(cur ?? []).filter((h) => h.id !== optimistic.id),
            ...res,
          ]);
        } catch (e) {
          qc.setQueryData<Hold[]>(holdsKey, (cur) =>
            (cur ?? []).filter((h) => h.id !== optimistic.id),
          );
          haptic.error();
          const taken = e instanceof ApiError && e.status === 409;
          showToast(t(taken ? 'seats.takenToast' : 'seats.failedToast'), 'error');
        }
      } catch {
        haptic.error();
        showToast(t('seats.failedToast'), 'error');
      } finally {
        pending.current.delete(seatId);
        if (pending.current.size === 0) {
          if (key) qc.invalidateQueries({ queryKey: key });
        }
      }
    },
    [qc, showtimeId, t],
  );
}

/** Seconds left until `expiresAt`, ticking every second; null when there is nothing to count. */
export function useCountdown(expiresAt: string | null, onExpire?: () => void): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  const left = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000))
    : null;
  useEffect(() => {
    if (left === 0) onExpire?.();
  }, [left, onExpire]);
  return left;
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "C7" */
export function seatLabel(seat: Pick<SeatState, 'rowLabel' | 'number'>): string {
  return `${seat.rowLabel}${seat.number}`;
}
