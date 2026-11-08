'use client';

import { errorMessage } from './errors-mn';

export class CallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(errorMessage(code));
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
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CallError(0, 'network');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new CallError(res.status, data.error ?? 'unknown');
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
