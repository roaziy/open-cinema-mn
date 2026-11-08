import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path of the backend package folder. Found by walking up to its package.json so it is
 * the same whether the code runs from `src/` (tsx, tests) or from the bundle in `dist/`.
 */
function findBackendRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('backend package.json not found');
    dir = parent;
  }
  return dir;
}

export const BACKEND_ROOT = findBackendRoot();
