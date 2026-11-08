import { SeatDeltaSchema } from '@open-cinema/shared';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import EventSource from 'react-native-sse';
import { API_BASE } from './http';
import { startWatchdog } from './watchdog';

export type SeatLiveState = 'free' | 'held' | 'sold';
/** `live` only once a snapshot has arrived; `error` means the stream was refused (e.g. unknown showtime) and is not retried. */
export type SeatStreamStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** The library re-opens by itself after an HTTP response ends or errors, this often. */
const HTTP_REPOLL_MS = 3000;

const seatList = SeatDeltaSchema.array();

function parse(data: string | null): unknown {
  try {
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Live seat states for a showtime: `{ [seatId]: 'free' | 'held' | 'sold' }`.
 * The first `snapshot` event replaces everything, `delta` events patch it. The library re-opens
 * after an HTTP response ends, `scheduleReopen` after a network failure, and a watchdog after
 * silence (the server pings every 20 s). The server sends a fresh snapshot on every (re)connect,
 * which replaces the state again, so no delta can be applied to a stale base.
 */
export function useSeatStream(showtimeId: string | null | undefined) {
  // Tagged with the showtime it belongs to, so switching showtimes never shows stale seats.
  const [live, setLive] = useState<{
    id: string;
    seats: Record<string, SeatLiveState>;
    status: SeatStreamStatus;
  } | null>(null);

  useEffect(() => {
    if (!showtimeId) return;

    const patch = (
      update: (cur: { seats: Record<string, SeatLiveState>; status: SeatStreamStatus }) => {
        seats: Record<string, SeatLiveState>;
        status: SeatStreamStatus;
      },
    ) =>
      setLive((prev) => {
        const cur = prev?.id === showtimeId ? prev : { seats: {}, status: 'connecting' as const };
        return { id: showtimeId, ...update(cur) };
      });

    const es = new EventSource<'snapshot' | 'delta' | 'ping'>(
      `${API_BASE}/showtimes/${encodeURIComponent(showtimeId)}/seats/stream`,
      { pollingInterval: HTTP_REPOLL_MS }, // public stream: no bearer, so a reconnect never replays an expired token
    );

    let stopped = false; // unmounted, or refused for good
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // react-native-sse only re-polls after an HTTP response. A network-level failure
    // (status 0: unreachable, Wi-Fi handoff, server restart) fires `error` and stops, so
    // reopen it ourselves with capped exponential backoff.
    const scheduleReopen = () => {
      if (stopped || retryTimer) return;
      const delay = Math.min(RETRY_MIN_MS * 2 ** attempt, RETRY_MAX_MS);
      attempt++;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!stopped) es.open();
      }, delay);
    };

    es.addEventListener('error', (e) => {
      if (stopped) return;
      const http = e.type === 'error' ? e.xhrStatus : 0;
      // 4xx other than 408/429 (unknown showtime...) will not fix itself: stop polling.
      if (http >= 400 && http < 500 && http !== 408 && http !== 429) {
        stopped = true;
        if (retryTimer) clearTimeout(retryTimer);
        // Deferred: the library arms its next poll right after this handler returns.
        setTimeout(() => es.close(), 0);
        patch((c) => ({ ...c, status: 'error' }));
        return;
      }
      patch((c) => ({ ...c, status: 'reconnecting' }));
      if (http === 0) scheduleReopen();
    });
    es.addEventListener('close', () => {
      if (!stopped) patch((c) => ({ ...c, status: 'reconnecting' }));
    });

    // A connection suspended in the background may be dead without any event: start fresh.
    const appState = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || stopped) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      attempt = 0;
      es.close();
      es.open();
    });

    // A connection can die without any event (a proxy dropping an idle stream, a sleeping radio).
    // No event of any kind for 45 s: start over, which also brings a fresh snapshot.
    const watchdog = startWatchdog(() => {
      if (stopped) return;
      patch((c) => ({ ...c, status: 'reconnecting' }));
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      es.close();
      es.open();
    });
    es.addEventListener('open', () => watchdog.feed());
    es.addEventListener('ping', () => watchdog.feed());

    es.addEventListener('snapshot', (e) => {
      watchdog.feed();
      const list = seatList.safeParse((parse(e.data) as { seats?: unknown } | null)?.seats);
      if (!list.success) return;
      const seats = Object.fromEntries(list.data.map((s) => [s.seatId, s.state]));
      attempt = 0;
      patch(() => ({ seats, status: 'live' }));
    });

    es.addEventListener('delta', (e) => {
      watchdog.feed();
      const list = seatList.safeParse((parse(e.data) as { changes?: unknown } | null)?.changes);
      if (!list.success || list.data.length === 0) return;
      const changes = list.data;
      patch((c) => {
        const seats = { ...c.seats };
        for (const ch of changes) seats[ch.seatId] = ch.state;
        return { ...c, seats };
      });
    });

    return () => {
      stopped = true;
      watchdog.stop();
      if (retryTimer) clearTimeout(retryTimer);
      appState.remove();
      es.removeAllEventListeners();
      es.close();
    };
  }, [showtimeId]);

  /**
   * Apply known changes locally (a seat you just released is free before the server says so).
   * The next delta or snapshot for a seat overrides this.
   */
  const patch = useCallback(
    (changes: { seatId: string; state: SeatLiveState }[]) => {
      if (!showtimeId || changes.length === 0) return;
      setLive((prev) => {
        const cur =
          prev?.id === showtimeId
            ? prev
            : { id: showtimeId, seats: {}, status: 'connecting' as const };
        const seats = { ...cur.seats };
        for (const c of changes) seats[c.seatId] = c.state;
        return { ...cur, seats };
      });
    },
    [showtimeId],
  );

  const current = live && live.id === showtimeId ? live : null;
  return {
    seats: current?.seats ?? EMPTY,
    status: current?.status ?? ('connecting' as SeatStreamStatus),
    patch,
  };
}

const EMPTY: Record<string, SeatLiveState> = {};
