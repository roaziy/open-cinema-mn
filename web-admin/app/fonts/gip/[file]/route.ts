import { readFile } from 'node:fs/promises';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import { apiUrl } from '@/lib/env';
import { GILROY_FILES, type GilroyWeight, gilroyPath } from '@/lib/fonts';

/** Gilroy is licensed for our own back office only: signed-in admins and staff, never the public. */
async function isBackOffice(req: Request): Promise<boolean> {
  const access = new RegExp(`(?:^|;\\s*)${ACCESS_COOKIE}=([^;]+)`).exec(
    req.headers.get('cookie') ?? '',
  )?.[1];
  if (!access) return false;
  try {
    const res = await fetch(`${apiUrl()}/v1/me`, {
      headers: { authorization: `Bearer ${decodeURIComponent(access)}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const { role } = (await res.json()) as { role?: string };
    return role === 'admin' || role === 'staff';
  } catch {
    return false;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const path = Object.hasOwn(GILROY_FILES, file) ? gilroyPath(file as GilroyWeight) : null;
  if (!path) return new Response(null, { status: 404 });
  if (!(await isBackOffice(req))) return new Response(null, { status: 404 });
  return new Response(await readFile(path), {
    headers: { 'content-type': 'font/otf', 'cache-control': 'private, max-age=86400' },
  });
}
