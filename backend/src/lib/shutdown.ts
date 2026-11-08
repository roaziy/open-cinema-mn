import type { Server } from 'node:http';

export type ShutdownParts = {
  server: Pick<Server, 'close' | 'closeAllConnections'>;
  /** Stops the sweeper timer; resolves when a pass that is running has finished. */
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
 * Returns a one-shot graceful shutdown. It stops accepting connections and ends SSE streams, then
 * lets in-flight requests and a running sweep pass finish before closing the database pool last.
 * Connections still open at `forceCloseAfterMs` are destroyed; at `timeoutMs` the process exits 1.
 */
export function createShutdown(parts: ShutdownParts): (signal: string) => Promise<void> {
  let started = false;
  return async (signal) => {
    if (started) return;
    started = true;
    console.log(`${signal} received, draining`);
    const hard = setTimeout(() => {
      console.error('shutdown timed out, forcing exit');
      parts.exit(1);
    }, parts.timeoutMs);
    hard.unref();
    const force = setTimeout(() => parts.server.closeAllConnections(), parts.forceCloseAfterMs);
    force.unref();
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
    parts.exit(code);
  };
}
