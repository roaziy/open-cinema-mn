import type { Server } from 'node:http';

/**
 * Shutdown timers derived from the longest outbound provider call, so a refund or charge that is
 * waiting on the provider can finish before connections are destroyed and the pool is closed.
 */
export function shutdownBudget(providerTimeoutMs: number) {
  return {
    forceCloseAfterMs: providerTimeoutMs + 5_000,
    timeoutMs: providerTimeoutMs + 8_000,
  };
}

/** While draining, keep-alive sockets that went idle are closed this often. */
const IDLE_CLOSE_EVERY_MS = 250;

export type ShutdownParts = {
  server: Pick<Server, 'close' | 'closeAllConnections' | 'closeIdleConnections'>;
  /** Raises the process-wide drain flag (lib/drain): no new payment provider call starts. */
  startDraining: () => void;
  /** Stops the sweeper timer; resolves once a running pass has stopped at its next item. */
  stopSweeper: () => Promise<void>;
  /** Ends long-lived SSE responses, which would otherwise keep `server.close` waiting. */
  endStreams: () => void;
  closePool: () => Promise<void>;
  exit: (code: number) => void;
  /** Hard-exit deadline; keep it below the process manager's kill timeout. */
  timeoutMs: number;
  /** After this long, still-open connections are destroyed so the pool can close in time. */
  forceCloseAfterMs: number;
};

/**
 * Returns a one-shot graceful shutdown. It raises the drain flag, stops accepting connections and
 * ends SSE streams, then lets in-flight requests and the current sweep item finish before closing
 * the database pool last. Connections still open at `forceCloseAfterMs` are destroyed; at
 * `timeoutMs` the process exits 1.
 */
export function createShutdown(parts: ShutdownParts): (signal: string) => Promise<void> {
  let started = false;
  return async (signal) => {
    if (started) return;
    started = true;
    parts.startDraining();
    console.log(`${signal} received, draining`);
    const hard = setTimeout(() => {
      console.error('shutdown timed out, forcing exit');
      parts.exit(1);
    }, parts.timeoutMs);
    hard.unref();
    const force = setTimeout(() => parts.server.closeAllConnections(), parts.forceCloseAfterMs);
    force.unref();
    // close() only drops the sockets idle at that moment; one whose response finishes later (an
    // ended SSE stream, a request that began before the drain) would sit out keepAliveTimeout.
    const idle = setInterval(() => parts.server.closeIdleConnections(), IDLE_CLOSE_EVERY_MS);
    idle.unref();
    let code = 0;
    try {
      const closed = new Promise<void>((resolve) => parts.server.close(() => resolve()));
      parts.endStreams();
      await Promise.all([closed, parts.stopSweeper()]);
      await parts.closePool();
    } catch (err) {
      console.error('shutdown failed', err);
      code = 1;
    }
    clearTimeout(hard);
    clearTimeout(force);
    clearInterval(idle);
    parts.exit(code);
  };
}
