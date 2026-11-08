import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorageProvider } from './index';

export const UPLOAD_DIR = fileURLToPath(new URL('../../uploads', import.meta.url));

/** Writes files under `dir`; the API serves that directory at `/media/*`. */
export class LocalStorage implements StorageProvider {
  constructor(
    private readonly publicUrl: string,
    private readonly dir = UPLOAD_DIR,
  ) {}

  async put(key: string, body: Buffer, _contentType: string): Promise<string> {
    const root = path.resolve(this.dir);
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) throw new Error('invalid storage key');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    return `${this.publicUrl.replace(/\/$/, '')}/media/${key.split(path.sep).join('/')}`;
  }
}
