import { createHash, createHmac } from 'node:crypto';
import type { StorageProvider } from './index';

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();

/** URI encoding for signed paths: every byte except A-Z a-z 0-9 - . _ ~ (encodeURIComponent also leaves !'()*). */
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export type SignInput = {
  method: string;
  /** Already URI-encoded path (encoded once). */
  path: string;
  /** Header names to sign, values as sent; must include `host` and `x-amz-date`. */
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** Signature Version 4 `Authorization` header (the signing R2 uses), for a request without a query string. */
export function signV4(r: SignInput): string {
  const headers = Object.fromEntries(
    Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]),
  );
  const amzDate = headers['x-amz-date'];
  if (!amzDate) throw new Error('x-amz-date header is required');
  const names = Object.keys(headers).sort();
  const signed = names.join(';');
  const canonical = [
    r.method,
    r.path,
    '',
    ...names.map((n) => `${n}:${headers[n]}`),
    '',
    signed,
    r.payloadHash,
  ].join('\n');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${r.region}/${r.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  let key = hmac(`AWS4${r.secretAccessKey}`, day);
  for (const part of [r.region, r.service, 'aws4_request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${r.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
}

export type R2Options = {
  /** Cloudflare account ID (R2 overview page, "Account Details"). */
  accountId: string;
  bucket: string;
  /** From an R2 API token with Object Read & Write on the bucket. */
  accessKeyId: string;
  secretAccessKey: string;
  /** Public URL of the bucket: its r2.dev URL or a custom domain. */
  publicUrl: string;
};

/**
 * Uploads to a Cloudflare R2 bucket with one signed PUT to R2's S3-API endpoint
 * (Cloudflare's own name for the protocol; no AWS account involved). Keys are unique per
 * upload, so objects are cached as immutable.
 */
export class R2Storage implements StorageProvider {
  constructor(
    private readonly o: R2Options,
    private readonly now: () => Date = () => new Date(),
    private readonly send: typeof fetch = fetch,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    const host = `${this.o.accountId}.r2.cloudflarestorage.com`;
    const path = `/${[this.o.bucket, ...key.split('/')].map(encode).join('/')}`;
    const payloadHash = sha256(body);
    const headers = {
      'cache-control': 'public, max-age=31536000, immutable',
      'content-type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': this.now()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, ''),
    };
    const authorization = signV4({
      method: 'PUT',
      path,
      headers: { ...headers, host },
      payloadHash,
      region: 'auto',
      service: 's3',
      accessKeyId: this.o.accessKeyId,
      secretAccessKey: this.o.secretAccessKey,
    });
    const res = await this.send(`https://${host}${path}`, {
      method: 'PUT',
      headers: { ...headers, authorization },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`r2 upload failed: ${res.status} ${detail}`);
    }
    return `${this.o.publicUrl.replace(/\/+$/, '')}/${key}`;
  }
}
