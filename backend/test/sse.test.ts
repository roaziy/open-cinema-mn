import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Db, db } from '../src/db/client';
import { branches, halls, movies, seatHolds, seats, showtimes, users } from '../src/db/schema';
import { SeatHub } from '../src/lib/seat-hub';
import { fixedClock, makeTestApp, one, resetDb } from './helpers';

const clock = fixedClock('2026-11-08T04:00:00Z');
let server: Server | undefined;
const aborts: AbortController[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const a of aborts.splice(0)) a.abort();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});
beforeEach(resetDb);

async function setup() {
  const [b] = await db
    .insert(branches)
    .values({ name: 'B', address: 'a', lat: 0, lng: 0 })
    .returning();
  const [h] = await db
    .insert(halls)
    .values({ branchId: one(b).id, name: 'H', screenWidthM: 10, screenHeightM: 5, screenXM: 5 })
    .returning();
  const [s1, s2] = await db
    .insert(seats)
    .values([
      { hallId: one(h).id, rowLabel: 'A', number: 1, xM: 1, yM: 1 },
      { hallId: one(h).id, rowLabel: 'A', number: 2, xM: 2, yM: 1 },
    ])
    .returning();
  const [m] = await db
    .insert(movies)
    .values({
      title: 'M',
      durationMin: 90,
      ageRating: '12+',
      posterUrl: 'p',
      status: 'now',
      releaseDate: '2026-11-01',
    })
    .returning();
  const [st] = await db
    .insert(showtimes)
    .values({
      movieId: one(m).id,
      hallId: one(h).id,
      startsAt: new Date('2026-11-08T11:00:00Z'),
      priceStandard: 1,
      pricePremium: 2,
    })
    .returning();
  const [u] = await db
    .insert(users)
    .values({ role: 'customer', phone: '+97699112045' })
    .returning();
  return { show: one(st), s1: one(s1), s2: one(s2), user: one(u) };
}

type Evt = { event: string; data: unknown };

/** Opens the stream and returns a reader that yields parsed SSE events and raw comments. */
async function open(path: string, hub: SeatHub, appDb: Db = db) {
  server = makeTestApp({ clock, seatHub: hub, db: appDb }).listen(0);
  await new Promise((r) => server?.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  const ac = new AbortController();
  aborts.push(ac);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: ac.signal });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const next = async (): Promise<Evt> => {
    for (;;) {
      const idx = buf.indexOf('\n\n');
      if (idx >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event && data) return { event, data: JSON.parse(data) };
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buf += decoder.decode(value, { stream: true });
    }
  };
  return { res, next };
}

describe('seat stream', () => {
  it('sends a named ping event every 20 s so clients can watch liveness', async () => {
    const f = await setup();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { next } = await open(`/v1/showtimes/${f.show.id}/seats/stream`, new SeatHub());
      expect((await next()).event).toBe('snapshot');
      vi.advanceTimersByTime(20_000);
      expect(await next()).toEqual({ event: 'ping', data: {} });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends the SSE headers and a snapshot of non-free seats first', async () => {
    const f = await setup();
    await db.insert(seatHolds).values({
      showtimeId: f.show.id,
      seatId: f.s1.id,
      userId: f.user.id,
      expiresAt: new Date('2026-11-08T04:10:00Z'),
    });
    const { res, next } = await open(`/v1/showtimes/${f.show.id}/seats/stream`, new SeatHub());
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(await next()).toEqual({
      event: 'snapshot',
      data: { seats: [{ seatId: f.s1.id, state: 'held' }] },
    });
  });

  it('gives a reconnecting client a full snapshot, not a delta', async () => {
    const f = await setup();
    const hub = new SeatHub();
    const path = `/v1/showtimes/${f.show.id}/seats/stream`;
    const first = await open(path, hub);
    expect((await first.next()).event).toBe('snapshot');
    await db.insert(seatHolds).values({
      showtimeId: f.show.id,
      seatId: f.s2.id,
      userId: f.user.id,
      expiresAt: new Date('2026-11-08T04:10:00Z'),
    });
    aborts[0]?.abort();
    const again = await open(path, hub);
    expect(await again.next()).toEqual({
      event: 'snapshot',
      data: { seats: [{ seatId: f.s2.id, state: 'held' }] },
    });
  });

  it('delivers a delta after a publish and stops after the client closes', async () => {
    const f = await setup();
    const hub = new SeatHub();
    const { next } = await open(`/v1/showtimes/${f.show.id}/seats/stream`, hub);
    expect((await next()).event).toBe('snapshot');
    hub.publish(f.show.id, [{ seatId: f.s1.id, state: 'sold' }]);
    expect(await next()).toEqual({
      event: 'delta',
      data: { changes: [{ seatId: f.s1.id, state: 'sold' }] },
    });
    // other showtimes do not leak in
    hub.publish('00000000-0000-4000-8000-000000000000', [{ seatId: f.s2.id, state: 'held' }]);
    hub.publish(f.show.id, [{ seatId: f.s2.id, state: 'free' }]);
    expect(await next()).toEqual({
      event: 'delta',
      data: { changes: [{ seatId: f.s2.id, state: 'free' }] },
    });
    expect(hub.listenerCount(f.show.id)).toBe(1);
    aborts[0]?.abort();
    await vi.waitFor(() => expect(hub.listenerCount(f.show.id)).toBe(0));
  });

  it('does not subscribe when the client drops during the first query', async () => {
    const f = await setup();
    const hub = new SeatHub();
    // Holds the first select (the existence check) until released.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let gated = false;
    const wrap = <T extends object>(builder: T): T =>
      new Proxy(builder, {
        get(target, prop, receiver) {
          if (prop === 'then' && !gated) {
            gated = true;
            const then = Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown;
            return (...a: unknown[]) => gate.then(() => then.apply(target, a));
          }
          const v = Reflect.get(target, prop, target);
          if (typeof v !== 'function') return v;
          return (...args: unknown[]) => {
            const out = v.apply(target, args);
            return out && typeof out === 'object' ? wrap(out) : out;
          };
        },
      });
    const slowDb = new Proxy(db, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target);
        if (prop === 'select') {
          return (...args: unknown[]) =>
            wrap((v as (...a: unknown[]) => object).apply(target, args));
        }
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as Db;
    const pending = open(`/v1/showtimes/${f.show.id}/seats/stream`, hub, slowDb);
    await vi.waitFor(() => expect(gated).toBe(true));
    aborts[0]?.abort();
    await pending.catch(() => {});
    await new Promise((r) => setTimeout(r, 100)); // let the server observe the close
    release();
    await new Promise((r) => setTimeout(r, 200)); // let the handler resume
    expect(hub.listenerCount(f.show.id)).toBe(0);
  });

  it('404s for an unknown showtime', async () => {
    await setup();
    const { res } = await open(
      '/v1/showtimes/00000000-0000-4000-8000-000000000000/seats/stream',
      new SeatHub(),
    );
    expect(res.status).toBe(404);
  });

  it('drops a delta published after shutdown ended the stream, instead of crashing', async () => {
    const f = await setup();
    const hub = new SeatHub();
    const crashes: unknown[] = [];
    const onCrash = (err: unknown) => crashes.push(err);
    process.on('uncaughtException', onCrash);
    try {
      const { next } = await open(`/v1/showtimes/${f.show.id}/seats/stream`, hub);
      expect((await next()).event).toBe('snapshot');
      hub.endStreams();
      // Same tick as the end: the route's close cleanup has not run, so its listener still fires.
      hub.publish(f.show.id, [{ seatId: f.s1.id, state: 'sold' }]);
      await expect(next()).rejects.toThrow('stream ended');
      await new Promise((r) => setTimeout(r, 50));
      expect(crashes).toEqual([]);
    } finally {
      process.off('uncaughtException', onCrash);
    }
  });

  it('refuses a late stream during drain and closes fast over a pooled keep-alive socket', async () => {
    const f = await setup();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const hub = new SeatHub();
    const { createShutdown } = await import('../src/lib/shutdown');
    const http = await import('node:http');
    server = makeTestApp({ clock, seatHub: hub }).listen(0, '127.0.0.1');
    await new Promise((r) => server?.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    // One pooled socket, like a reverse proxy's upstream connection.
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const path = `/v1/showtimes/${f.show.id}/seats/stream`;
    const connect = () =>
      new Promise<{ status: number; ended: Promise<void> }>((resolve, reject) => {
        http
          .get({ port, host: '127.0.0.1', path, agent }, (res) => {
            res.resume();
            resolve({
              status: res.statusCode ?? 0,
              ended: new Promise((r) => res.on('end', () => r())),
            });
          })
          .on('error', reject);
      });
    const first = await connect();
    expect(first.status).toBe(200);
    await vi.waitFor(() => expect(hub.listenerCount(f.show.id)).toBe(1));

    const started = Date.now();
    const closed = createShutdown({
      server: server as Server,
      // The hub's own guard is under test; drain.test.ts covers the process-wide flag.
      startDraining: () => {},
      endStreams: () => hub.endStreams(),
      stopSweeper: async () => {},
      closePool: async () => {},
      exit: () => {},
      timeoutMs: 9000,
      forceCloseAfterMs: 6000,
    })('SIGTERM');
    await first.ended;
    // The client reconnects at once on the same socket: it must be refused, not held open.
    const second = await connect().catch(() => null);
    expect(second).not.toBeNull();
    expect(second?.status).toBe(503);
    await second?.ended;
    await closed;
    expect(Date.now() - started).toBeLessThan(2000);
    agent.destroy();
  });
});
