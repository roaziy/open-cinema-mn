import type { ScanResult } from '@open-cinema/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_CLOSE_MS, ScanController } from '../lib/scan/controller';

const result = (scanId: string, over: Partial<ScanResult> = {}): ScanResult => ({
  scanId,
  result: 'admitted',
  ticket: null,
  previous: null,
  undoUntil: '2999-01-01T00:00:00Z',
  ...over,
});

function make(opts: { send?: (b: { scanId: string }) => Promise<unknown>; label?: string } = {}) {
  let n = 0;
  const sounds: string[] = [];
  const undoCalls: { scanId: string; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const bodies: Record<string, unknown>[] = [];
  const c = new ScanController({
    deviceId: 'dev',
    doorLabel: () => opts.label,
    send: async (b) => {
      bodies.push(b as unknown as Record<string, unknown>);
      return opts.send ? opts.send(b) : result(b.scanId);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    newId: () => `scan-${++n}`,
    undo: (scanId) =>
      new Promise<void>((resolve, reject) => undoCalls.push({ scanId, resolve, reject })),
    errorText: () => 'undo failed',
    signal: (k) => void sounds.push(k),
    onResult: () => {},
    onUndone: () => {},
  });
  return { c, sounds, undoCalls, bodies };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ScanController', () => {
  it('shows a card with sound, drops a second read while it is up, auto-closes admits', async () => {
    const { c, sounds } = make();
    expect(c.scan({ token: 'A' })).toBe(true);
    expect(c.scan({ token: 'B' })).toBe(false);
    await flush();
    expect(c.getSnapshot().flow).toMatchObject({ kind: 'card', result: { scanId: 'scan-1' } });
    expect(sounds).toEqual(['admit']);
    expect(c.scan({ token: 'C' })).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTO_CLOSE_MS + 10);
    expect(c.getSnapshot().flow.kind).toBe('idle');
  });

  it('sends the door label and the typed order and seat', async () => {
    const { c, bodies } = make({ label: 'Хаалга 2' });
    c.scan({ orderNo: 'OC-1', seat: 'F3' });
    await flush();
    expect(bodies[0]).toMatchObject({
      orderNo: 'OC-1',
      seat: 'F3',
      deviceId: 'dev',
      deviceLabel: 'Хаалга 2',
    });
  });

  it('a late Undo answer for card A never closes scan B or drops its answer', async () => {
    const { c, sounds, undoCalls } = make();
    c.scan({ token: 'A' });
    await flush();
    // Undo is in flight; the guest-facing card is closed by hand meanwhile.
    const undoing = c.undo('scan-1');
    expect(c.getSnapshot().undoing).toBe('scan-1');
    c.dismiss();
    expect(c.scan({ token: 'B' })).toBe(true);
    // A's undo resolves while B is still being sent...
    undoCalls[0]?.resolve();
    await undoing;
    await flush();
    // ...and B's answer still arrives, with its card and sound.
    expect(c.getSnapshot().flow).toMatchObject({ kind: 'card', result: { scanId: 'scan-2' } });
    expect(sounds.filter((s) => s === 'admit')).toHaveLength(2);
  });

  it('a late Undo answer does not close B once B has its card', async () => {
    const { c, undoCalls } = make();
    c.scan({ token: 'A' });
    await flush();
    const undoing = c.undo('scan-1');
    c.dismiss();
    c.scan({ token: 'B' });
    await flush();
    expect(c.getSnapshot().flow).toMatchObject({ kind: 'card', result: { scanId: 'scan-2' } });
    undoCalls[0]?.resolve();
    await undoing;
    expect(c.getSnapshot().flow).toMatchObject({ kind: 'card', result: { scanId: 'scan-2' } });
  });

  it('does not auto-close a card while its Undo is in flight, then closes it on success', async () => {
    const { c, undoCalls } = make();
    c.scan({ token: 'A' });
    await flush();
    const undoing = c.undo('scan-1');
    await vi.advanceTimersByTimeAsync(AUTO_CLOSE_MS * 3);
    expect(c.getSnapshot().flow.kind).toBe('card');
    undoCalls[0]?.resolve();
    await undoing;
    expect(c.getSnapshot().flow.kind).toBe('idle');
    expect(c.getSnapshot().notice).toContain('Буцаалаа');
  });

  it('a failed Undo keeps the card, shows why, and re-arms the auto-close', async () => {
    const { c, undoCalls } = make();
    c.scan({ token: 'A' });
    await flush();
    const undoing = c.undo('scan-1');
    undoCalls[0]?.reject(new Error('x'));
    await undoing;
    expect(c.getSnapshot()).toMatchObject({ undoing: null, notice: 'undo failed' });
    expect(c.getSnapshot().flow.kind).toBe('card');
    await vi.advanceTimersByTimeAsync(AUTO_CLOSE_MS + 10);
    expect(c.getSnapshot().flow.kind).toBe('idle');
  });

  it('rejects stay until closed', async () => {
    const { c } = make({
      send: async (b) => result(b.scanId, { result: 'already_used', undoUntil: null }),
    });
    c.scan({ token: 'A' });
    await flush();
    await vi.advanceTimersByTimeAsync(AUTO_CLOSE_MS * 4);
    expect(c.getSnapshot().flow.kind).toBe('card');
  });

  it('a network failure retries the same scan id and shows no card until the server answers', async () => {
    let calls = 0;
    const ids: string[] = [];
    const { c } = make({
      send: async (b) => {
        ids.push(b.scanId);
        if (++calls < 3) throw Object.assign(new Error('x'), { status: 0, code: 'network' });
        return result(b.scanId);
      },
    });
    c.scan({ token: 'A' });
    await vi.advanceTimersByTimeAsync(10);
    expect(c.getSnapshot().flow).toMatchObject({ kind: 'sending', retry: 'network' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(new Set(ids)).toEqual(new Set(['scan-1']));
    expect(c.getSnapshot().flow.kind).toBe('card');
  });
});
