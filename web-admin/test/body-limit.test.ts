import { describe, expect, it } from 'vitest';
import { readCapped } from '../lib/body-limit';

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('http://x.test/api/admin/uploads', {
    method: 'POST',
    body,
    headers,
    // @ts-expect-error Node's fetch needs this for stream bodies
    duplex: 'half',
  });

describe('readCapped', () => {
  it('returns the bytes of a small body', async () => {
    const out = await readCapped(post('hello'), 100);
    expect(new TextDecoder().decode(out as Uint8Array)).toBe('hello');
  });

  it('refuses on the declared length without consuming the body', async () => {
    const req = post(new Uint8Array(10), { 'content-length': '5000' });
    expect(await readCapped(req, 100)).toBeNull();
    expect(req.bodyUsed).toBe(false);
  });

  it('counts a body that has no or a false length and stops early', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(40));
        if (pulled > 50) c.close();
      },
    });
    expect(await readCapped(post(body, { 'content-length': '10' }), 100)).toBeNull();
    expect(pulled).toBeLessThan(10);
  });

  it('accepts a body of exactly the limit and an empty one', async () => {
    expect((await readCapped(post(new Uint8Array(100)), 100))?.byteLength).toBe(100);
    expect((await readCapped(post(null), 100))?.byteLength).toBe(0);
  });
});
