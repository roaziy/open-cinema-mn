import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import type { Env } from '../env';

/**
 * TLS options for the Postgres pool.
 * `require` encrypts without checking the certificate; `verify` also checks it against the CA file.
 * A `sslmode` in the connection string is ignored on purpose: this setting is the single switch.
 */
export function dbSsl(
  e: Pick<Env, 'DATABASE_SSL' | 'DATABASE_CA_FILE'>,
  read: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): ConnectionOptions | false {
  if (e.DATABASE_SSL === 'off') return false;
  if (e.DATABASE_SSL === 'verify') {
    if (!e.DATABASE_CA_FILE)
      throw new Error('DATABASE_CA_FILE is required when DATABASE_SSL=verify');
    return { ca: read(e.DATABASE_CA_FILE), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

const SSL_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'];

/** node-postgres lets `sslmode` in the URL override the `ssl` option; DATABASE_SSL is the only switch. */
export function stripSslMode(url: string): string {
  if (!SSL_PARAMS.some((k) => new RegExp(`[?&]${k}=`).test(url))) return url;
  try {
    const u = new URL(url);
    for (const k of SSL_PARAMS) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}
