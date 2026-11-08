import { type ScanBody, type ScanResult, ScanResultSchema } from '@open-cinema/shared';

export type RetryReason = 'network' | 'busy';

/** Statuses worth trying again with the same scan id; everything else is a real answer. */
export function isRetryable(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return false;
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

/** 0.8 s, 1.6 s, 3.2 s, then every 5 s. A door queue should not wait longer between tries. */
export function backoffMs(attempt: number): number {
  return Math.min(800 * 2 ** Math.min(attempt - 1, 10), 5000);
}

export type SendOutcome =
  | { kind: 'done'; result: ScanResult }
  | { kind: 'failed'; code: string }
  | { kind: 'cancelled' };

export type SendDeps = {
  /** One HTTP attempt. Rejects with an error carrying `status` and `code`. */
  send: (body: ScanBody) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  onRetry: (reason: RetryReason) => void;
  isCancelled: () => boolean;
};

/**
 * Sends one scan and keeps retrying a lost request with the SAME `scanId`, so the server answers
 * from its stored row instead of scanning twice. The only way out with a result is a well-formed
 * answer for this exact scan id; a network error can never turn into an admit.
 */
export async function sendScan(body: ScanBody, deps: SendDeps): Promise<SendOutcome> {
  for (let attempt = 1; ; attempt++) {
    if (deps.isCancelled()) return { kind: 'cancelled' };
    let raw: unknown;
    try {
      raw = await deps.send(body);
    } catch (err) {
      if (deps.isCancelled()) return { kind: 'cancelled' };
      if (!isRetryable(err)) {
        const code = (err as { code?: unknown } | null)?.code;
        return { kind: 'failed', code: typeof code === 'string' ? code : 'unknown' };
      }
      deps.onRetry((err as { status: number }).status === 0 ? 'network' : 'busy');
      await deps.sleep(backoffMs(attempt));
      continue;
    }
    if (deps.isCancelled()) return { kind: 'cancelled' };
    const parsed = ScanResultSchema.safeParse(raw);
    if (!parsed.success || parsed.data.scanId !== body.scanId || parsed.data.result === 'undone') {
      return { kind: 'failed', code: 'bad_response' };
    }
    return { kind: 'done', result: parsed.data };
  }
}
