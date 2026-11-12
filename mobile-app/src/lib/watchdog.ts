/** The server sends a `ping` every 20 s; this long without any event means the stream is dead. */
export const STREAM_SILENCE_MS = 45_000;

export type Watchdog = {
  /** Any sign of life (open, snapshot, delta, ping) restarts the countdown. */
  feed: () => void;
  stop: () => void;
};

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const real: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Calls `onSilence` when `feed` has not been called for `ms`, then keeps waiting (so a stream
 * that stays dead after a reconnect is retried again). Starts counting immediately.
 */
export function startWatchdog(
  onSilence: () => void,
  ms = STREAM_SILENCE_MS,
  timers: Timers = real,
): Watchdog {
  let handle: unknown;
  let stopped = false;
  const arm = () => {
    if (stopped) return;
    handle = timers.set(() => {
      handle = undefined;
      if (stopped) return;
      onSilence();
      arm();
    }, ms);
  };
  arm();
  return {
    feed() {
      if (stopped) return;
      if (handle !== undefined) timers.clear(handle);
      arm();
    },
    stop() {
      stopped = true;
      if (handle !== undefined) timers.clear(handle);
      handle = undefined;
    },
  };
}
