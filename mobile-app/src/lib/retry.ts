/** Waits before retry 1, 2, 3... A rate-limited server gets a little air. */
export const BACKOFF_MS = [1000, 2000, 4000];
/** A server-sent Retry-After is honoured, but never for longer than this. */
export const MAX_WAIT_MS = 8000;

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const statusOf = (e: unknown): unknown => (e as { status?: unknown } | null)?.status;

/** 429 and gateway-style 5xx say "try again later"; nothing about the session is wrong. */
export function isTransient(e: unknown): boolean {
  const status = statusOf(e);
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** Only 429: the rate limiter answers before the handler runs, so nothing was changed server-side. */
export const isRateLimited = (e: unknown): boolean => statusOf(e) === 429;

export type RetryOptions = {
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  /** Which failures are worth another try. */
  retryable: (e: unknown) => boolean;
  /**
   * Return false to stop retrying (the caller no longer wants the result). Checked again after
   * every wait: the world can change while sleeping (e.g. the user logs out), and a request
   * sent then would replay a token that is no longer valid.
   */
  shouldContinue?: () => boolean;
};

/** Wait for the retry: the error's `retryAfter` (seconds) if it has one, else the next delay. */
function waitFor(e: unknown, delay: number): number {
  const ra = (e as { retryAfter?: unknown } | null)?.retryAfter;
  return typeof ra === 'number' && ra >= 0 ? Math.min(ra * 1000, MAX_WAIT_MS) : delay;
}

/**
 * Run `fn`, retrying retryable failures after each delay. The last error is thrown once the
 * delays run out; any other error is thrown at once.
 */
export async function retryTransient<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const { delays = BACKOFF_MS, sleep = sleepMs, retryable, shouldContinue } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const delay = delays[attempt];
      if (delay === undefined || !retryable(e) || shouldContinue?.() === false) throw e;
      await sleep(waitFor(e, delay));
      if (shouldContinue?.() === false) throw e;
    }
  }
}

type Deps<T> = {
  /** The refresh request itself. */
  call: () => Promise<T>;
  /** True once the session was replaced or cleared while waiting: the result is dropped. */
  isStale: () => boolean;
  apply: (tokens: T) => Promise<void>;
  clear: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  delays?: readonly number[];
};

/**
 * One refresh with its failure policy. Resolves true when new tokens were applied, false when
 * the session is gone (401: the tokens are cleared). Any other failure throws and keeps the
 * tokens. Only 429 is retried: the limiter answers before the token is touched, so replaying
 * is safe; a 502/504 may have rotated the token already, and replaying it would read as theft.
 */
export async function runRefresh<T>(deps: Deps<T>): Promise<boolean> {
  try {
    const tokens = await retryTransient(deps.call, {
      retryable: isRateLimited,
      shouldContinue: () => !deps.isStale(),
      sleep: deps.sleep,
      delays: deps.delays,
    });
    if (deps.isStale()) return false;
    await deps.apply(tokens);
    return true;
  } catch (e) {
    if ((e as { status?: unknown } | null)?.status === 401) {
      if (!deps.isStale()) await deps.clear();
      return false;
    }
    throw e;
  }
}
