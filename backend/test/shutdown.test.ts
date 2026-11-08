import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShutdown } from '../src/lib/shutdown';

function parts(over: Partial<Parameters<typeof createShutdown>[0]> = {}) {
  const order: string[] = [];
  const p = {
    server: {
      close: vi.fn((cb?: () => void) => {
        order.push('close');
        cb?.();
      }),
      closeAllConnections: vi.fn(() => order.push('closeAll')),
    },
    stopSweeper: vi.fn(() => order.push('sweeper')),
    closePool: vi.fn(async () => {
      order.push('pool');
    }),
    exit: vi.fn((c: number) => order.push(`exit${c}`)),
    timeoutMs: 50,
    ...over,
  };
  return { p, order };
}

afterEach(() => vi.restoreAllMocks());

describe('graceful shutdown', () => {
  it('stops everything in order and exits 0, once', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { p, order } = parts();
    const shutdown = createShutdown(p as never);
    await shutdown('SIGTERM');
    await shutdown('SIGINT');
    expect(order).toEqual(['sweeper', 'close', 'closeAll', 'pool', 'exit0']);
  });

  it('exits 1 when closing the pool fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { p } = parts({ closePool: vi.fn().mockRejectedValue(new Error('boom')) });
    await createShutdown(p as never)('SIGTERM');
    expect(p.exit).toHaveBeenCalledWith(1);
  });

  it('forces exit 1 when the server never closes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { p } = parts({ server: { close: vi.fn(), closeAllConnections: vi.fn() } });
    void createShutdown(p as never)('SIGTERM');
    await vi.waitFor(() => expect(p.exit).toHaveBeenCalledWith(1));
  });
});
