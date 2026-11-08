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

  listenerCount(showtimeId: string): number {
    return this.listeners.get(showtimeId)?.size ?? 0;
  }

  publish(showtimeId: string, changes: SeatDelta[]): void {
    if (changes.length === 0) return;
    for (const listener of this.listeners.get(showtimeId) ?? []) listener(changes);
  }
}
