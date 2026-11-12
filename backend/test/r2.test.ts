import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { R2Storage, signV4 } from '../src/storage/r2';

// The SigV4 test suite published by AWS, who define the signing R2 uses (aws-sdk-js-v3, packages/signature-v4-crt/src/suite.fixture.ts).
const suite = {
  region: 'us-east-1',
  service: 'service',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

describe('signV4', () => {
  it('matches the get-vanilla vector', () => {
    const auth = signV4({
      ...suite,
      method: 'GET',
      path: '/',
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: hash(''),
    });
    expect(auth).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('matches the post-x-www-form-urlencoded vector (signed body hash)', () => {
    const auth = signV4({
      ...suite,
      method: 'POST',
      path: '/',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'example.amazonaws.com',
        'x-amz-date': '20150830T123600Z',
      },
      payloadHash: hash('Param1=value1'),
    });
    expect(auth).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a',
    );
  });
});

describe('R2Storage', () => {
  const options = {
    accountId: '0123456789abcdef0123456789abcdef',
    bucket: 'media',
    accessKeyId: 'key-id',
    secretAccessKey: 'secret',
    publicUrl: 'https://media.example.com/',
  };
  const at = () => new Date('2026-11-12T04:05:06.789Z');

  it('PUTs a signed, cache-forever object and returns its public URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const body = Buffer.from('png bytes');
    const url = await new R2Storage(options, at, send).put('media/a b.png', body, 'image/png');

    expect(url).toBe('https://media.example.com/media/a b.png');
    expect(calls).toHaveLength(1);
    const { url: target, init } = calls[0] as { url: string; init: RequestInit };
    expect(target).toBe(
      'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/media/media/a%20b.png',
    );
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-amz-date']).toBe('20261112T040506Z');
    expect(headers['x-amz-content-sha256']).toBe(createHash('sha256').update(body).digest('hex'));
    expect(headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(headers['content-type']).toBe('image/png');
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=key-id\/20261112\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('throws with the status when the bucket refuses the upload', async () => {
    const send = (async () =>
      new Response('<Error>AccessDenied</Error>', { status: 403 })) as unknown as typeof fetch;
    await expect(
      new R2Storage(options, at, send).put('media/x.png', Buffer.from('x'), 'image/png'),
    ).rejects.toThrow(/r2 upload failed: 403 <Error>AccessDenied/);
  });
});
