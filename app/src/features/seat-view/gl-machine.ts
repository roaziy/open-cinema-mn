/**
 * Fallback state machine for the 3D view. `loading` becomes `ready` only after a render that
 * really drew something, and `failed` (show the 2D diagram) is final: a thrown render, a shader
 * error, a lost context, or no successful draw within the watchdog time.
 */
export type GlStatus = 'loading' | 'ready' | 'failed';
export type GlEvent = { type: 'drew' } | { type: 'error'; reason: string } | { type: 'timeout' };

export function glReducer(status: GlStatus, event: GlEvent): GlStatus {
  if (status === 'failed') return status;
  switch (event.type) {
    case 'drew':
      return 'ready';
    case 'error':
      return 'failed';
    case 'timeout':
      return status === 'loading' ? 'failed' : status;
  }
}

export type GlMachine = {
  getState: () => GlStatus;
  subscribe: (listener: () => void) => () => void;
  dispatch: (event: GlEvent) => void;
  /** Arm the watchdog (first call only). */
  start: () => void;
  /** Stop the clock while the app is in the background; resume continues with the time left. */
  pause: () => void;
  resume: () => void;
  dispose: () => void;
};

export function createGlMachine(opts: {
  timeoutMs: number;
  initial?: GlStatus;
  onFail?: (reason: string) => void;
}): GlMachine {
  let status: GlStatus = opts.initial ?? 'loading';
  let started = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let remaining = opts.timeoutMs;
  let armedAt = 0;
  const listeners = new Set<() => void>();

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const dispatch = (event: GlEvent) => {
    const next = glReducer(status, event);
    if (next === status) return;
    status = next;
    if (next !== 'loading') clear();
    if (next === 'failed') {
      opts.onFail?.(
        event.type === 'error' ? event.reason : `no frame drawn within ${opts.timeoutMs} ms`,
      );
    }
    for (const l of listeners) l();
  };
  const arm = (ms: number) => {
    armedAt = Date.now();
    timer = setTimeout(() => {
      timer = null;
      dispatch({ type: 'timeout' });
    }, ms);
  };

  return {
    getState: () => status,
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    dispatch,
    start: () => {
      if (started || status !== 'loading') return;
      started = true;
      arm(remaining);
    },
    pause: () => {
      if (!timer) return;
      clear();
      remaining = Math.max(0, remaining - (Date.now() - armedAt));
    },
    resume: () => {
      if (!started || status !== 'loading' || timer) return;
      arm(remaining);
    },
    dispose: clear,
  };
}
