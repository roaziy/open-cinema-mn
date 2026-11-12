import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorage } from '../src/storage';
import { LocalStorage, UPLOAD_DIR } from '../src/storage/local';
import { R2Storage } from '../src/storage/r2';
import { makeTestApp } from './helpers';

const base = {
  API_PUBLIC_URL: 'http://localhost:8080',
  R2_ACCOUNT_ID: undefined,
  R2_BUCKET: undefined,
  R2_ACCESS_KEY_ID: undefined,
  R2_SECRET_ACCESS_KEY: undefined,
  R2_PUBLIC_URL: undefined,
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

  it('builds R2 storage when configured', () => {
    const s = createStorage({
      ...base,
      STORAGE_PROVIDER: 'r2',
      R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      R2_BUCKET: 'media',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_PUBLIC_URL: 'https://media.example.com',
    });
    expect(s).toBeInstanceOf(R2Storage);
  });

  it('throws when r2 is selected without its settings', () => {
    expect(() => createStorage({ ...base, STORAGE_PROVIDER: 'r2' })).toThrow(
      /R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL/,
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
