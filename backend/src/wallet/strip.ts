import sharp from 'sharp';
import { type Env, env } from '../env';

/** Wallet's event-ticket strip is 375 x 98 points; built at @3x and scaled down. */
const W = 1125;
const H = 294;

export type Strip = { x1: Buffer; x2: Buffer; x3: Buffer };

/** A vertical gradient as an SVG mask: alpha `from` at `start`, `to` at `end` (0..1 of the height). */
const ramp = (start: number, end: number, from: number, to: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="${start}" stop-color="#fff" stop-opacity="${from}"/><stop offset="${end}" stop-color="#fff" stop-opacity="${to}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`,
  );

/**
 * The movie's banner as the pass strip: sharp at the top, blurring progressively towards the
 * bottom, where it melts into the pass colour `background` (so the strip has no hard edge).
 */
export async function makeStrip(image: Buffer, background: string): Promise<Strip> {
  const base = await sharp(image)
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .flatten({ background })
    .png()
    .toBuffer();
  const blurred = await sharp(base)
    .blur(24)
    .ensureAlpha()
    .composite([{ input: ramp(0.3, 0.95, 0, 1), blend: 'dest-in' }])
    .png()
    .toBuffer();
  const melt = await sharp({ create: { width: W, height: H, channels: 4, background } })
    .composite([{ input: ramp(0.45, 1, 0, 1), blend: 'dest-in' }])
    .png()
    .toBuffer();
  const full = await sharp(base)
    .composite([{ input: blurred }, { input: melt }])
    .png()
    .toBuffer();
  // Full-colour PNG (Wallet only takes PNG): a palette shows banding in the blur.
  const out = (w: number, h: number) =>
    sharp(full).resize(w, h).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const [x3, x2, x1] = await Promise.all([out(W, H), out(750, 196), out(375, 98)]);
  return { x1, x2, x3 };
}

const MAX_CACHED = 64;
const cache = new Map<string, Promise<Strip | null>>();

const MAX_BANNER_BYTES = 15 * 1024 * 1024;

/**
 * Banner URLs come from movie records, so the server only fetches from its own storage (the API's
 * /media and the R2 public URL), never follows redirects and caps the size: a movie pointing at
 * any other address gets no strip instead of making the server request it.
 */
export function trustedImageUrl(
  url: string,
  e: Pick<Env, 'API_PUBLIC_URL' | 'R2_PUBLIC_URL'> = env,
): boolean {
  const origins = [e.API_PUBLIC_URL, e.R2_PUBLIC_URL].flatMap((u) => {
    try {
      return u ? [new URL(u).origin] : [];
    } catch {
      return [];
    }
  });
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && origins.includes(u.origin);
  } catch {
    return false;
  }
}

async function download(url: string): Promise<Buffer> {
  if (!trustedImageUrl(url)) throw new Error('banner is not in this server’s storage');
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: 'error' });
  if (!res.ok) throw new Error(`banner ${res.status}`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BANNER_BYTES) {
    throw new Error('banner too large');
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_BANNER_BYTES) throw new Error('banner too large');
  return body;
}

/**
 * The strip for a banner URL, built once per banner and colour and kept in memory. Null when the
 * image cannot be fetched or read: the pass is then issued without a strip (a failure is not
 * cached, so the next pass retries).
 */
export function walletStrip(
  url: string,
  background: string,
  load: (url: string) => Promise<Buffer> = download,
): Promise<Strip | null> {
  const key = `${url}|${background}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const made = load(url)
    .then((image) => makeStrip(image, background))
    .catch((err) => {
      console.warn('wallet strip could not be built', String(err));
      cache.delete(key);
      return null;
    });
  cache.set(key, made);
  // ponytail: oldest-first eviction, an LRU only if many films rotate within one process
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  return made;
}
