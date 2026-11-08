import type { ServerResponse } from 'node:http';
import type { SeatDelta } from '@open-cinema/shared';

export type SeatListener = (changes: SeatDelta[]) => void;

/**
 * Fan-out of seat state changes to open SSE streams.
 * ponytail: single instance; Postgres LISTEN/NOTIFY when scaling out
 */
export class SeatHub {
  private listeners = new Map<string, Set<SeatListener>>();

  subscribe(showtimeId: string, listener: SeatListener): () => void {
    let set = this.listeners.get(showtimeId);
    if (!set) {
      set = new Set();
      this.listeners.set(showtimeId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(showtimeId);
    };
  }

  private streams = new Set<ServerResponse>();

  /** Registers an open SSE response so shutdown can end it; the returned function unregisters. */
  trackStream(res: ServerResponse): () => void {
    this.streams.add(res);
    return () => {
      this.streams.delete(res);
    };
  }

  /** Ends every tracked SSE response (graceful shutdown). */
  endStreams(): void {
    for (const res of [...this.streams]) res.end();
    this.streams.clear();
  }

  listenerCount(showtimeId: string): number {
    return this.listeners.get(showtimeId)?.size ?? 0;
  }

  publish(showtimeId: string, changes: SeatDelta[]): void {
    if (changes.length === 0) return;
    for (const listener of this.listeners.get(showtimeId) ?? []) listener(changes);
  }
}
