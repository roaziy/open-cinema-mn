import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { streamGate } from '../src/lib/rate-limit';

describe('streamGate', () => {
  it('allows `max` open streams per client and frees a slot when one closes', async () => {
    const app = express();
    const held: express.Response[] = [];
    app.get('/s', streamGate(2), (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(':ok\n\n');
      held.push(res);
    });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    const open = () =>
      new Promise<{ status: number; close: () => void }>((resolve) => {
        const ctrl = new AbortController();
        fetch(`http://127.0.0.1:${port}/s`, { signal: ctrl.signal })
          .then((r) => resolve({ status: r.status, close: () => ctrl.abort() }))
          .catch(() => {});
      });
    try {
      const a = await open();
      const b = await open();
      const c = await open();
      expect([a.status, b.status, c.status]).toEqual([200, 200, 429]);
      a.close();
      await new Promise((r) => setTimeout(r, 100));
      const d = await open();
      expect(d.status).toBe(200);
      b.close();
      d.close();
    } finally {
      for (const r of held) r.end();
      server.close();
    }
  });
});

describe('API ceiling', () => {
  it('answers 429 once a client passes the limit', async () => {
    const { createLimiters } = await import('../src/lib/rate-limit');
    const app = express();
    const limiters = createLimiters();
    app.use(limiters.bookings);
    app.get('/x', (_req, res) => {
      res.json({ ok: true });
    });
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await request(app).get('/x')).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
