import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../src/services/bookings');
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Answers the sweeper's selects in order (due, late, owed), each after `gate`. */
function fakeDb(results: { id: string }[][], gate: Promise<void> = Promise.resolve()) {
  const queue = [...results];
  const rows = () => gate.then(() => queue.shift() ?? []);
  const select = vi.fn(() => ({
    from: () => ({ where: rows, innerJoin: () => ({ where: rows }) }),
  }));
  return { select, transaction: async () => [] };
}

const sweepDeps = (db: ReturnType<typeof fakeDb>) => ({
  db,
  clock: () => new Date('2026-11-08T00:00:00Z'),
  seatHub: { publish: () => {} },
});

describe('startSweeper stop', () => {
  it('awaits a pass that is mid-run', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const db = fakeDb([], gate);
    const { startSweeper, SWEEP_INTERVAL_MS } = await import('../src/jobs/sweeper');
    const stop = startSweeper(sweepDeps(db) as never);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(db.select).toHaveBeenCalled(); // the pass started and is blocked on the gate

    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(stopped).toBe(false); // still waiting for the running pass
    release();
    await stopping;
    expect(stopped).toBe(true);
    expect(db.select).toHaveBeenCalledTimes(3); // due, late and owed: the pass ran to the end

    db.select.mockClear();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 2);
    expect(db.select).not.toHaveBeenCalled(); // timer is stopped
  });

  it('stops between items once draining: a queued slow refund is never started', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { PROVIDER_TIMEOUT_MS } = await vi.importActual<
      typeof import('../src/services/bookings')
    >('../src/services/bookings');
    // Each refund holds the provider for the full timeout.
    const refund = vi.fn(
      (_db: unknown, _id: string, _deps: unknown) =>
        new Promise<void>((r) => setTimeout(r, PROVIDER_TIMEOUT_MS)),
    );
    vi.doMock('../src/services/bookings', () => ({ confirmBooking: vi.fn(), refundOwed: refund }));
    const { startSweeper, SWEEP_INTERVAL_MS } = await import('../src/jobs/sweeper');
    const { startDraining } = await import('../src/lib/drain');
    const { createShutdown, shutdownBudget } = await import('../src/lib/shutdown');

    const db = fakeDb([[], [], [{ id: 'owed-1' }, { id: 'owed-2' }]]);
    const stop = startSweeper(sweepDeps(db) as never);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(refund).toHaveBeenCalledTimes(1); // the first refund is waiting on the provider

    const exit = vi.fn();
    const shutdown = createShutdown({
      server: {
        close: (cb?: (err?: Error) => void) => {
          cb?.();
          return undefined as never;
        },
        closeAllConnections: () => {},
        closeIdleConnections: () => {},
      },
      startDraining,
      stopSweeper: stop,
      endStreams: () => {},
      closePool: async () => {},
      exit,
      ...shutdownBudget(PROVIDER_TIMEOUT_MS),
    })('SIGINT');
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS);

    expect(refund).toHaveBeenCalledExactlyOnceWith(db, 'owed-1', expect.anything());
    await shutdown;
    expect(exit).toHaveBeenCalledExactlyOnceWith(0); // at 20 s, well before the 28 s hard exit
  });
});
