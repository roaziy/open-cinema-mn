import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, resetDb } from './helpers';

describe('GET /v1/health', () => {
  beforeEach(resetDb);

  it('reports ok and database reachable', async () => {
    const res = await request(makeTestApp()).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: true });
  });

  it('maps unknown routes to a JSON 404', async () => {
    const res = await request(makeTestApp()).get('/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });
});
