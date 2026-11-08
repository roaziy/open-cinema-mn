import type { ScanBody, ScanResult } from '@open-cinema/shared';
import { cardFor, type SoundKind } from './card';
import { type Flow, flowReducer, idleFlow } from './flow';
import { type SendDeps, sendScan } from './send';

/** What the door typed or scanned; the controller adds scan id, device and door label. */
export type ScanInput = { token: string } | { orderNo: string; seat: string };

export type ControllerState = {
  flow: Flow;
  /** Scan id of the admit whose Undo request is in flight. */
  undoing: string | null;
  notice: string | null;
};

export type ControllerDeps = {
  deviceId: string;
  doorLabel: () => string | undefined;
  send: SendDeps['send'];
  sleep: SendDeps['sleep'];
  newId: () => string;
  undo: (scanId: string) => Promise<void>;
  /** A Mongolian sentence for a failed undo. */
  errorText: (err: unknown) => string;
  signal: (kind: SoundKind) => void;
  onResult: (r: ScanResult) => void;
  onUndone: (scanId: string) => void;
  now?: () => number;
};

export const AUTO_CLOSE_MS = 4500;
const NOTICE_MS = 3500;

/**
 * Everything the scanner screen does after a code is read, outside React so its races can be
 * tested: one scan at a time, retries on the same scan id, a card that closes itself, and an
 * Undo whose late answer can only ever touch its own card.
 */
export class ScanController {
  private state: ControllerState = { flow: idleFlow, undoing: null, notice: null };
  private listeners = new Set<() => void>();
  private busy = false;
  private generation = 0;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: ControllerDeps) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): ControllerState => this.state;

  private set(patch: Partial<ControllerState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  private dispatch(a: Parameters<typeof flowReducer>[1]) {
    this.set({ flow: flowReducer(this.state.flow, a) });
  }

  /** Starts a scan. False when one is already running or a card is up: that read is dropped. */
  scan(input: ScanInput): boolean {
    if (this.busy) return false;
    this.busy = true;
    const scanId = this.deps.newId();
    const mine = ++this.generation;
    const label = this.deps.doorLabel();
    const body = {
      ...input,
      scanId,
      deviceId: this.deps.deviceId,
      ...(label ? { deviceLabel: label } : {}),
    } as ScanBody;
    this.dispatch({
      type: 'start',
      scanId,
      token: 'token' in input ? input.token : `${input.orderNo} ${input.seat}`,
    });
    void sendScan(body, {
      send: this.deps.send,
      sleep: this.deps.sleep,
      onRetry: (reason) => this.dispatch({ type: 'retrying', scanId, reason }),
      isCancelled: () => this.generation !== mine,
    }).then((out) => {
      if (out.kind === 'cancelled' || this.generation !== mine) return;
      if (out.kind === 'failed') {
        this.deps.signal('repeat');
        this.dispatch({ type: 'failed', scanId, code: out.code });
        return;
      }
      this.deps.signal(cardFor(out.result).sound);
      this.dispatch({
        type: 'settled',
        scanId,
        result: out.result,
        at: (this.deps.now ?? Date.now)(),
      });
      this.deps.onResult(out.result);
      this.armAutoClose(out.result);
    });
    return true;
  }

  /**
   * Closes the card or cancels the request. With a scan id it closes only that scan's card, so
   * something that finishes late (an Undo) can never shut the next guest's answer.
   */
  dismiss(onlyScanId?: string) {
    const f = this.state.flow;
    if (onlyScanId !== undefined) {
      const showing =
        f.kind === 'card'
          ? f.result.scanId
          : f.kind === 'sending' || f.kind === 'failed'
            ? f.scanId
            : null;
      if (showing !== onlyScanId) return;
    }
    clearTimeout(this.closeTimer);
    this.generation++;
    this.busy = false;
    this.dispatch({ type: 'dismiss' });
  }

  async undo(scanId: string) {
    if (this.state.undoing !== null) return;
    clearTimeout(this.closeTimer);
    this.set({ undoing: scanId });
    try {
      await this.deps.undo(scanId);
      this.deps.onUndone(scanId);
      this.deps.signal('repeat');
      this.dismiss(scanId);
      this.notify('Буцаалаа. Тасалбар дахин хүчинтэй.');
    } catch (err) {
      this.notify(this.deps.errorText(err));
      const f = this.state.flow;
      if (f.kind === 'card' && f.result.scanId === scanId) this.armAutoClose(f.result);
    } finally {
      this.set({ undoing: null });
    }
  }

  private notify(text: string) {
    clearTimeout(this.noticeTimer);
    this.set({ notice: text });
    this.noticeTimer = setTimeout(() => this.set({ notice: null }), NOTICE_MS);
  }

  /** Quick outcomes close themselves so the line keeps moving; a reject waits to be read. */
  private armAutoClose(result: ScanResult) {
    clearTimeout(this.closeTimer);
    if (cardFor(result).tone === 'reject') return;
    this.closeTimer = setTimeout(() => {
      // Never while an Undo for this card is still out: its answer decides what happens next.
      if (this.state.undoing !== null) return;
      this.dismiss(result.scanId);
    }, AUTO_CLOSE_MS);
  }

  dispose() {
    clearTimeout(this.closeTimer);
    clearTimeout(this.noticeTimer);
    this.generation++;
    this.listeners.clear();
  }
}
