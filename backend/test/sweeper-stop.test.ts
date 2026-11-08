import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('startSweeper stop', () => {
  it('awaits a pass that is mid-run', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const select = vi.fn(() => ({
      from: () => ({ where: () => gate.then(() => []) }),
    }));
    const deps = {
      db: {
        select,
        transaction: async () => [],
      },
      clock: () => new Date('2026-11-08T00:00:00Z'),
      seatHub: { publish: () => {} },
    };
    const { startSweeper, SWEEP_INTERVAL_MS } = await import('../src/jobs/sweeper');
    const stop = startSweeper(deps as never);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(select).toHaveBeenCalled(); // the pass started and is blocked on the gate

    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(stopped).toBe(false); // still waiting for the running pass
    release();
    await stopping;
    expect(stopped).toBe(true);

    select.mockClear();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 2);
    expect(select).not.toHaveBeenCalled(); // timer is stopped
  });
});
