import { readFile } from 'node:fs/promises';
import { GILROY_FILES, type GilroyWeight, gilroyPath } from '@/lib/fonts';

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const path = file in GILROY_FILES ? gilroyPath(file as GilroyWeight) : null;
  if (!path) return new Response(null, { status: 404 });
  return new Response(await readFile(path), {
    headers: { 'content-type': 'font/otf', 'cache-control': 'public, max-age=86400' },
  });
}
