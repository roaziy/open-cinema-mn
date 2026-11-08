import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeatHub } from '../src/lib/seat-hub';
import { createShutdown } from '../src/lib/shutdown';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => vi.restoreAllMocks());

function silence() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: (server.address() as AddressInfo).port };
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ port, host: '127.0.0.1', path, agent: false }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

describe('graceful shutdown', () => {
  it('drains a slow request, ends SSE, awaits a running sweep and closes the pool last', async () => {
    silence();
    const hub = new SeatHub();
    const order: string[] = [];
    const { server, port } = await listen((req, res) => {
      if (req.url === '/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.flushHeaders();
        hub.trackStream(res);
        return;
      }
      setTimeout(() => {
        order.push('request-done');
        res.end('done');
      }, 300);
    });
    const stream = new Promise<void>((resolve) => {
      http.get({ port, host: '127.0.0.1', path: '/stream', agent: false }, (res) => {
        res.resume();
        res.on('end', () => {
          order.push('sse-ended');
          resolve();
        });
      });
    });
    const slow = get(port, '/slow');
    await sleep(50); // both requests are in flight

    const exit = vi.fn((c: number) => order.push(`exit${c}`));
    await createShutdown({
      server,
      endStreams: () => hub.endStreams(),
      stopSweeper: async () => {
        await sleep(150);
        order.push('sweep-done');
      },
      closePool: async () => {
        order.push('pool');
      },
      exit,
      timeoutMs: 3000,
      forceCloseAfterMs: 2000,
    })('SIGTERM');

    expect(await slow).toEqual({ status: 200, body: 'done' });
    await stream;
    expect(order).toEqual(['sse-ended', 'sweep-done', 'request-done', 'pool', 'exit0']);
  });

  it('stops accepting new connections once draining', async () => {
    silence();
    const { server, port } = await listen((_req, res) => setTimeout(() => res.end('ok'), 200));
    const slow = get(port, '/');
    await sleep(30);
    const done = createShutdown({
      server,
      endStreams: () => {},
      stopSweeper: async () => {},
      closePool: async () => {},
      exit: () => {},
      timeoutMs: 3000,
      forceCloseAfterMs: 2000,
    })('SIGTERM');
    await sleep(30);
    await expect(get(port, '/')).rejects.toThrow();
    await slow;
    await done;
  });

  it('destroys connections that outlive the drain budget, then still exits 0', async () => {
    silence();
    const { server, port } = await listen(() => {}); // never answers
    const hung = get(port, '/').catch(() => 'reset');
    await sleep(30);
    const exit = vi.fn();
    await createShutdown({
      server,
      endStreams: () => {},
      stopSweeper: async () => {},
      closePool: async () => {},
      exit,
      timeoutMs: 2000,
      forceCloseAfterMs: 100,
    })('SIGTERM');
    expect(await hung).toBe('reset');
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits 1 when closing the pool fails, and runs only once', async () => {
    silence();
    const { server } = await listen((_q, r) => r.end());
    const exit = vi.fn();
    const shutdown = createShutdown({
      server,
      endStreams: () => {},
      stopSweeper: async () => {},
      closePool: vi.fn().mockRejectedValue(new Error('boom')),
      exit,
      timeoutMs: 2000,
      forceCloseAfterMs: 1000,
    });
    await shutdown('SIGTERM');
    await shutdown('SIGINT');
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces exit 1 when the sweep never finishes', async () => {
    silence();
    const { server } = await listen((_q, r) => r.end());
    const exit = vi.fn();
    void createShutdown({
      server,
      endStreams: () => {},
      stopSweeper: () => new Promise(() => {}),
      closePool: async () => {},
      exit,
      timeoutMs: 100,
      forceCloseAfterMs: 50,
    })('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
