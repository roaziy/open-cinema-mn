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
      startDraining: () => order.push('draining'),
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
    expect(order).toEqual(['draining', 'sse-ended', 'sweep-done', 'request-done', 'pool', 'exit0']);
  });

  it('stops accepting new connections once draining', async () => {
    silence();
    const { server, port } = await listen((_req, res) => setTimeout(() => res.end('ok'), 200));
    const slow = get(port, '/');
    await sleep(30);
    const done = createShutdown({
      server,
      startDraining: () => {},
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
      startDraining: () => {},
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

  it('closes a keep-alive socket that goes idle mid-drain instead of waiting out its timeout', async () => {
    silence();
    const { server, port } = await listen((_req, res) => setTimeout(() => res.end('ok'), 200));
    // The client keeps the socket for reuse once the in-flight response is done.
    const agent = new http.Agent({ keepAlive: true });
    const inFlight = new Promise<void>((resolve) => {
      http.get({ port, host: '127.0.0.1', path: '/', agent }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
    });
    await sleep(30);
    const started = Date.now();
    await createShutdown({
      server,
      startDraining: () => {},
      endStreams: () => {},
      stopSweeper: async () => {},
      closePool: async () => {},
      exit: () => {},
      timeoutMs: 9000,
      forceCloseAfterMs: 8000,
    })('SIGTERM');
    await inFlight;
    // server.keepAliveTimeout is 5 s; the drain must not sit on the idle socket that long.
    expect(Date.now() - started).toBeLessThan(1000);
    agent.destroy();
  }, 10_000);

  it('exits 1 when closing the pool fails, and runs only once', async () => {
    silence();
    const { server } = await listen((_q, r) => r.end());
    const exit = vi.fn();
    const shutdown = createShutdown({
      server,
      startDraining: () => {},
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
      startDraining: () => {},
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

describe('shutdown budget', () => {
  it('outlasts the provider timeout and stays inside the pm2 kill timeout', async () => {
    const { PROVIDER_TIMEOUT_MS } = await import('../src/services/bookings');
    const { shutdownBudget } = await import('../src/lib/shutdown');
    const { createRequire } = await import('node:module');
    const pm2 = createRequire(import.meta.url)('../ecosystem.config.cjs');
    const { forceCloseAfterMs, timeoutMs } = shutdownBudget(PROVIDER_TIMEOUT_MS);
    expect(forceCloseAfterMs).toBeGreaterThan(PROVIDER_TIMEOUT_MS);
    expect(timeoutMs).toBeGreaterThan(forceCloseAfterMs);
    expect(pm2.apps[0].kill_timeout).toBeGreaterThan(timeoutMs);
  });
});
