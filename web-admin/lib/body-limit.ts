/**
 * Largest request body the proxy will buffer. Vercel Functions refuse bodies over 4.5 MB before
 * this code runs; the browser keeps uploads under 4 MB (lib/image-resize.ts) to stay inside.
 */
export const MAX_BODY_BYTES = 4.5 * 1024 * 1024;

/**
 * Reads a request body, giving up (null) as soon as it is clearly or actually over the limit:
 * a declared length is checked before reading, and a body that lies about it, or has none, is
 * counted while it streams so it never gets fully buffered.
 */
export async function readCapped(req: Request, max = MAX_BODY_BYTES): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
