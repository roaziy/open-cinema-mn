/** Waits before retry 1, 2, 3... A rate-limited or briefly failing server gets a little air. */
export const BACKOFF_MS = [1000, 2000, 4000];

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 429 and gateway-style 5xx say "try again later"; nothing about the session is wrong. */
export function isTransient(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Run `fn`, retrying transient failures after each delay in `delays`. The last error is
 * thrown once the delays run out; any other error is thrown at once.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  delays: readonly number[] = BACKOFF_MS,
  sleep: (ms: number) => Promise<void> = sleepMs,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const delay = delays[attempt];
      if (delay === undefined || !isTransient(e)) throw e;
      await sleep(delay);
    }
  }
}
