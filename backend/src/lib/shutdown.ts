import type { Server } from 'node:http';

export type ShutdownParts = {
  server: Pick<Server, 'close' | 'closeAllConnections'>;
  stopSweeper: () => void;
  closePool: () => Promise<void>;
  exit: (code: number) => void;
  /** Hard-exit deadline; keep it below the process manager's kill timeout. */
  timeoutMs: number;
};

/**
 * Returns a one-shot shutdown: stop the sweeper and new connections, end open (SSE) streams,
 * close the database pool, exit. If anything hangs, exit 1 after `timeoutMs`.
 */
export function createShutdown(parts: ShutdownParts): (signal: string) => Promise<void> {
  let started = false;
  return async (signal) => {
    if (started) return;
    started = true;
    console.log(`${signal} received, shutting down`);
    const hard = setTimeout(() => {
      console.error('shutdown timed out, forcing exit');
      parts.exit(1);
    }, parts.timeoutMs);
    hard.unref();
    let code = 0;
    try {
      parts.stopSweeper();
      const closed = new Promise<void>((resolve) => parts.server.close(() => resolve()));
      // Long-lived SSE responses would keep `close` waiting forever.
      parts.server.closeAllConnections();
      await closed;
      await parts.closePool();
    } catch (err) {
      console.error('shutdown failed', err);
      code = 1;
    }
    clearTimeout(hard);
    parts.exit(code);
  };
}
