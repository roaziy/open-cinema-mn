/**
 * How long the BFF waits for the API. Door requests are short and retried by the scanner, so a
 * stalled connection must fail fast (504) instead of holding the screen for minutes; uploads and
 * reports get longer.
 */
export function upstreamTimeoutMs(upstreamPath: string): number {
  return upstreamPath.startsWith('/v1/staff/') ? 8_000 : 60_000;
}

/** True for the error `AbortSignal.timeout` raises. */
export function isTimeout(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'TimeoutError';
}
