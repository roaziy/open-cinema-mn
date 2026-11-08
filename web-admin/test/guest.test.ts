import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAppleDevice, loadGuestTickets, mapLink, walletHref } from '../lib/guest';
import { config } from '../proxy';

const TOKEN = 'ol1.11111111-1111-4111-8111-111111111111.abcDEF_-123';
const client = { ip: null, userAgent: null };

afterEach(() => vi.unstubAllGlobals());

function stubFetch(res: Response | Error) {
  const fn = vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('loadGuestTickets', () => {
  it('does not ask the API about a token that cannot be genuine', async () => {
    const fn = stubFetch(new Response('{}'));
    expect(await loadGuestTickets('', client)).toEqual({ kind: 'missing' });
    expect(await loadGuestTickets('../../admin', client)).toEqual({ kind: 'missing' });
    expect(await loadGuestTickets('a b', client)).toEqual({ kind: 'missing' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('maps 404 to missing, other failures and bad bodies to unavailable, never a crash', async () => {
    stubFetch(new Response('{"error":"not_found"}', { status: 404 }));
    expect(await loadGuestTickets(TOKEN, client)).toEqual({ kind: 'missing' });
    stubFetch(new Response('boom', { status: 500 }));
    expect(await loadGuestTickets(TOKEN, client)).toEqual({ kind: 'unavailable' });
    stubFetch(new Response('{"nope":1}', { status: 200 }));
    expect(await loadGuestTickets(TOKEN, client)).toEqual({ kind: 'unavailable' });
    stubFetch(new TypeError('fetch failed'));
    expect(await loadGuestTickets(TOKEN, client)).toEqual({ kind: 'unavailable' });
  });

  it('asks without credentials and never from the cache', async () => {
    const fn = stubFetch(new Response('{}', { status: 404 }));
    await loadGuestTickets(TOKEN, client);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/v1/t/${TOKEN}`);
    expect(init.cache).toBe('no-store');
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization|cookie/i);
  });
});

describe('guest helpers', () => {
  it('shows Wallet only on Apple devices', () => {
    expect(isAppleDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(isAppleDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(true);
    expect(isAppleDevice('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe(false);
    expect(isAppleDevice(null)).toBe(false);
  });

  it('builds the map link and a Wallet href that carries no signed url', () => {
    expect(mapLink(47.9, 106.9)).toBe('https://www.google.com/maps/search/?api=1&query=47.9,106.9');
    const href = walletHref(TOKEN, 'abc');
    expect(href).toBe(`/t/${TOKEN}/pass/abc`);
    expect(href).not.toMatch(/sig=|exp=/);
  });
});

describe('proxy', () => {
  it('does not run on the public guest route', () => {
    const covered = (path: string) =>
      config.matcher.some((m) => new RegExp(`^${m.replace(/:path\*/g, '.*')}$`).test(path));
    expect(covered('/t/ol1.x.y')).toBe(false);
    expect(covered('/t/ol1.x.y/pass/abc')).toBe(false);
    expect(covered('/staff/scan')).toBe(true);
  });
});
