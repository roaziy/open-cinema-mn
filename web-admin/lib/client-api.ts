'use client';

import { errorMessage } from './errors-mn';
import { MAX_SOURCE_BYTES } from './image-resize';

export class CallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(errorMessage(code));
  }
}

async function readJson(res: Response, signal: AbortSignal | undefined, fallback: unknown) {
  try {
    return await res.json();
  } catch {
    if (signal?.aborted) throw new CallError(0, 'network');
    if (res.ok) throw new CallError(res.status, 'bad_response');
    return fallback;
  }
}

/**
 * Browser -> BFF -> API. Every admin mutation goes through here (one pattern, one place), so the
 * session cookies stay httpOnly and errors always come back as a Mongolian message.
 */
export async function call<T = undefined>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  let res: Response;
  // A stalled connection is reported like a lost one, so the caller can retry. The timer also
  // covers reading the body: a response that stops half way is a lost response, not an answer.
  const signal = opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new CallError(0, 'network');
  }
  if (!res.ok) {
    const data = await readJson(res, signal, {});
    throw new CallError(res.status, (data as { error?: string }).error ?? 'unknown');
  }
  if (res.status === 204) return undefined as T;
  return (await readJson(res, signal, undefined)) as T;
}

/** Image upload (poster, backdrop). Resolves to the stored file's URL. */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.set('file', file);
  let res: Response;
  try {
    res = await fetch('/api/admin/uploads', { method: 'POST', body: form });
  } catch {
    throw new CallError(0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new CallError(res.status, data.error ?? 'unknown');
  return data.url;
}

export function messageOf(err: unknown): string {
  return err instanceof CallError ? err.message : errorMessage('unknown');
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Why a picked file will not even be tried (wrong type, absurdly large), or null. It is shrunk before upload. */
export function imageProblem(file: { size: number; type: string }): string | null {
  if (!IMAGE_TYPES.has(file.type)) return errorMessage('unsupported_media_type');
  if (file.size > MAX_SOURCE_BYTES) return errorMessage('file_too_large');
  return null;
}
