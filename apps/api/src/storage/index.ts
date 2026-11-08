import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env';

export interface StorageProvider {
  /** Stores `body` under `key` and returns its public URL. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
}

const UPLOAD_DIR = fileURLToPath(new URL('../../uploads', import.meta.url));

/** Minimal local stub; the full local + supabase providers come later. */
export class LocalStorage implements StorageProvider {
  constructor(
    private readonly dir = UPLOAD_DIR,
    private readonly baseUrl = `${env.API_PUBLIC_URL}/uploads`,
  ) {}

  async put(key: string, body: Buffer, _contentType: string): Promise<string> {
    const target = path.resolve(this.dir, key);
    if (!target.startsWith(path.resolve(this.dir) + path.sep))
      throw new Error('invalid storage key');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    return `${this.baseUrl}/${key.split(path.sep).join('/')}`;
  }
}

export function createStorage(): StorageProvider {
  return new LocalStorage();
}
