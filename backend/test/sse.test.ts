import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import { branches, halls, movies, seatHolds, seats, showtimes, users } from '../src/db/schema';
import { SeatHub } from '../src/lib/seat-hub';
import { fixedClock, makeTestApp, resetDb } from './helpers';

const clock = fixedClock('2026-11-08T04:00:00Z');
let server: Server | undefined;
const aborts: AbortController[] = [];

afterEach(async () => {
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
    .values({ branchId: b!.id, name: 'H', screenWidthM: 10, screenHeightM: 5, screenXM: 5 })
    .returning();
  const [s1, s2] = await db
    .insert(seats)
    .values([
      { hallId: h!.id, rowLabel: 'A', number: 1, xM: 1, yM: 1 },
      { hallId: h!.id, rowLabel: 'A', number: 2, xM: 2, yM: 1 },
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
      movieId: m!.id,
      hallId: h!.id,
      startsAt: new Date('2026-11-08T11:00:00Z'),
      priceStandard: 1,
      pricePremium: 2,
    })
    .returning();
  const [u] = await db
    .insert(users)
    .values({ role: 'customer', phone: '+97699112045' })
    .returning();
  return { show: st!, s1: s1!, s2: s2!, user: u! };
}

type Evt = { event: string; data: unknown };

/** Opens the stream and returns a reader that yields parsed SSE events and raw comments. */
async function open(path: string, hub: SeatHub) {
  server = makeTestApp({ clock, seatHub: hub }).listen(0);
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
    aborts[0]?.abort();
    await new Promise((r) => setTimeout(r, 50));
    expect(() => hub.publish(f.show.id, [{ seatId: f.s1.id, state: 'free' }])).not.toThrow();
  });

  it('404s for an unknown showtime', async () => {
    await setup();
    const { res } = await open(
      '/v1/showtimes/00000000-0000-4000-8000-000000000000/seats/stream',
      new SeatHub(),
    );
    expect(res.status).toBe(404);
  });
});
