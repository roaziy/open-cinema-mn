import { type Env, env } from '../env';
import { LocalStorage } from './local';
import { R2Storage } from './r2';

export interface StorageProvider {
  /** Stores `body` under `key` and returns its public URL. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
}

const R2_REQUIRED = [
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_URL',
] as const;

/** Picks the provider named by STORAGE_PROVIDER; never falls back silently. */
export function createStorage(
  e: Pick<Env, 'STORAGE_PROVIDER' | 'API_PUBLIC_URL' | (typeof R2_REQUIRED)[number]> = env,
): StorageProvider {
  if (e.STORAGE_PROVIDER === 'r2') {
    const missing = R2_REQUIRED.filter((k) => !e[k]);
    if (missing.length > 0) {
      throw new Error(`STORAGE_PROVIDER=r2 requires ${missing.join(', ')}`);
    }
    return new R2Storage({
      accountId: e.R2_ACCOUNT_ID as string,
      bucket: e.R2_BUCKET as string,
      accessKeyId: e.R2_ACCESS_KEY_ID as string,
      secretAccessKey: e.R2_SECRET_ACCESS_KEY as string,
      publicUrl: e.R2_PUBLIC_URL as string,
    });
  }
  return new LocalStorage(e.API_PUBLIC_URL);
}

export { UPLOAD_DIR } from './local';
