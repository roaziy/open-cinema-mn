import { SeatDeltaSchema } from '@open-cinema/shared';
import { useEffect, useState } from 'react';
import EventSource from 'react-native-sse';
import { API_BASE } from './http';

export type SeatLiveState = 'free' | 'held' | 'sold';
export type SeatStreamStatus = 'connecting' | 'live' | 'reconnecting';

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
 * The first `snapshot` event replaces everything, `delta` events patch it. The library
 * reconnects by itself and the server sends a fresh snapshot on every (re)connect, which
 * replaces the state again, so no delta can be applied to a stale base.
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

    const es = new EventSource<'snapshot' | 'delta'>(
      `${API_BASE}/showtimes/${encodeURIComponent(showtimeId)}/seats/stream`,
      { pollingInterval: 3000 }, // public stream: no bearer, so a reconnect never replays an expired token
    );

    es.addEventListener('open', () => patch((c) => ({ ...c, status: 'live' })));
    es.addEventListener('error', () => patch((c) => ({ ...c, status: 'reconnecting' })));
    es.addEventListener('close', () => patch((c) => ({ ...c, status: 'reconnecting' })));

    es.addEventListener('snapshot', (e) => {
      const list = seatList.safeParse((parse(e.data) as { seats?: unknown } | null)?.seats);
      if (!list.success) return;
      const seats = Object.fromEntries(list.data.map((s) => [s.seatId, s.state]));
      patch(() => ({ seats, status: 'live' }));
    });

    es.addEventListener('delta', (e) => {
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
      es.removeAllEventListeners();
      es.close();
    };
  }, [showtimeId]);

  const current = live && live.id === showtimeId ? live : null;
  return {
    seats: current?.seats ?? EMPTY,
    status: current?.status ?? ('connecting' as SeatStreamStatus),
  };
}

const EMPTY: Record<string, SeatLiveState> = {};
