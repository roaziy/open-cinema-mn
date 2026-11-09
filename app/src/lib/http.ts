import Constants from 'expo-constants';
import { resolveApiOrigin } from './dev-host';

/** Where Metro is served from: `expoConfig.hostUri` in dev builds, `debuggerHost` in Expo Go. */
function devServerHostUri(): string | undefined {
  const go = Constants.expoGoConfig as { debuggerHost?: string } | null;
  const m2 = Constants.manifest2 as { extra?: { expoGo?: { debuggerHost?: string } } } | null;
  return Constants.expoConfig?.hostUri ?? go?.debuggerHost ?? m2?.extra?.expoGo?.debuggerHost;
}

const API_ORIGIN = resolveApiOrigin(
  (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, ''),
  { dev: __DEV__, hostUri: devServerHostUri() },
);

export const API_BASE = `${API_ORIGIN}/v1`;

/** Non-2xx response (`{ error, message? }`) or a network failure (`status` 0, `code` "network"). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    /** The parsed error body, for codes that carry extra fields (e.g. `seat_taken` -> `seatIds`). */
    readonly body?: Record<string, unknown>,
    /** Seconds from a `Retry-After` header, when the server sent one. */
    readonly retryAfter?: number,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

export type RequestOptions = Omit<RequestInit, 'body'> & {
  /** Serialized as JSON with the right content type. */
  json?: unknown;
  bearer?: string | null;
};

/** Plain fetch against `/v1`: no auth handling, no retries. Returns undefined for 204. */
export async function rawRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { json, bearer, headers, ...rest } = opts;
  const h = new Headers(headers);
  h.set('Accept', 'application/json');
  if (json !== undefined) h.set('Content-Type', 'application/json');
  if (bearer) h.set('Authorization', `Bearer ${bearer}`);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: h,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch {
    throw new ApiError(0, 'network');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const err = (body ?? {}) as { error?: unknown; message?: unknown };
    throw new ApiError(
      res.status,
      typeof err.error === 'string' ? err.error : `http_${res.status}`,
      typeof err.message === 'string' ? err.message : undefined,
      body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined,
      parseRetryAfter(res.headers.get('Retry-After')),
    );
  }
  return body as T;
}

function parseRetryAfter(value: string | null): number | undefined {
  // An empty header is no header (Number('') would read as 0).
  const n = value === null || value.trim() === '' ? Number.NaN : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
