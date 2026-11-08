import { type Env, env } from '../env';
import { LocalStorage } from './local';
import { SupabaseStorage } from './supabase';

export interface StorageProvider {
  /** Stores `body` under `key` and returns its public URL. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
}

/** Picks the provider named by STORAGE_PROVIDER; never falls back silently. */
export function createStorage(
  e: Pick<
    Env,
    | 'STORAGE_PROVIDER'
    | 'API_PUBLIC_URL'
    | 'SUPABASE_URL'
    | 'SUPABASE_SERVICE_ROLE_KEY'
    | 'SUPABASE_BUCKET'
  > = env,
): StorageProvider {
  if (e.STORAGE_PROVIDER === 'supabase') {
    const missing = (
      ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_BUCKET'] as const
    ).filter((k) => !e[k]);
    if (missing.length > 0) {
      throw new Error(`STORAGE_PROVIDER=supabase requires ${missing.join(', ')}`);
    }
    return new SupabaseStorage(
      e.SUPABASE_URL as string,
      e.SUPABASE_SERVICE_ROLE_KEY as string,
      e.SUPABASE_BUCKET as string,
    );
  }
  return new LocalStorage(e.API_PUBLIC_URL);
}

export { UPLOAD_DIR } from './local';
