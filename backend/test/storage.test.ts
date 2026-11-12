import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorage } from '../src/storage';
import { LocalStorage, UPLOAD_DIR } from '../src/storage/local';
import { SupabaseStorage } from '../src/storage/supabase';
import { makeTestApp } from './helpers';

const base = {
  API_PUBLIC_URL: 'http://localhost:8080',
  SUPABASE_URL: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  SUPABASE_BUCKET: undefined,
};

describe('LocalStorage', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'oc-storage-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('writes the file and returns a /media URL', async () => {
    const s = new LocalStorage('http://localhost:8080/', dir);
    const url = await s.put('posters/a.png', Buffer.from('hello'), 'image/png');
    expect(url).toBe('http://localhost:8080/media/posters/a.png');
    expect((await readFile(path.join(dir, 'posters/a.png'))).toString()).toBe('hello');
  });

  it('rejects keys that escape the directory', async () => {
    const s = new LocalStorage('http://localhost:8080', dir);
    await expect(s.put('../evil.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(/invalid/);
  });
});

describe('createStorage', () => {
  it('uses local storage by default', () => {
    expect(createStorage({ ...base, STORAGE_PROVIDER: 'local' })).toBeInstanceOf(LocalStorage);
  });

  it('builds Supabase storage when configured', () => {
    const s = createStorage({
      ...base,
      STORAGE_PROVIDER: 'supabase',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      SUPABASE_BUCKET: 'media',
    });
    expect(s).toBeInstanceOf(SupabaseStorage);
  });

  it('throws when supabase is selected without its settings', () => {
    expect(() => createStorage({ ...base, STORAGE_PROVIDER: 'supabase' })).toThrow(
      /SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET/,
    );
  });
});

describe('/media', () => {
  it('serves uploads cross-origin and 404s as JSON when missing', async () => {
    const key = `test-${process.pid}.txt`;
    const url = await new LocalStorage('http://localhost:8080').put(
      key,
      Buffer.from('ok'),
      'text/plain',
    );
    const app = makeTestApp();
    try {
      const hit = await request(app).get(new URL(url).pathname);
      expect(hit.status).toBe(200);
      expect(hit.headers['cross-origin-resource-policy']).toBe('cross-origin');
      const miss = await request(app).get('/media/nope.png');
      expect(miss.status).toBe(404);
      expect(miss.body).toEqual({ error: 'not_found' });
    } finally {
      await rm(path.join(UPLOAD_DIR, key), { force: true });
    }
  });
});
