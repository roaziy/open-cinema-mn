import type { TicketView } from '@open-cinema/shared';
import { describe, expect, it } from 'vitest';
import {
  applyList,
  applyTicket,
  emptyCache,
  isOfflineError,
  listFrom,
  parseCache,
  serialize,
  ticketFrom,
} from './ticket-cache-core';

const ticket = (id: string, over: Partial<TicketView> = {}): TicketView => ({
  id,
  bookingId: 'b1',
  orderNo: 'OC-10029',
  status: 'valid',
  usedAt: null,
  seat: { rowLabel: 'F', number: 3, kind: 'standard' },
  hallName: 'Hall 1',
  showtime: { id: 's1', startsAt: '2026-11-08T11:00:00.000Z', format: '2D' },
  movie: {
    id: 'm1',
    title: 'Movie',
    posterUrl: 'https://x.mn/p.jpg',
    backdropUrl: null,
    tone: '#2E6BF0',
    ageRating: '12+',
    durationMin: 100,
    genres: [],
    status: 'now',
    releaseDate: '2026-11-01',
  },
  branch: { id: 'br1', name: 'Central', address: 'a', lat: 47.9, lng: 106.9 },
  qrToken: 'oc1.token',
  checkCode: 'K7Q2',
  passUrl: 'https://api.example/pass/signed',
  ...over,
});

const t0 = new Date('2026-11-08T05:00:00Z');
const t1 = new Date('2026-11-08T06:00:00Z');

describe('ticket cache', () => {
  it('keeps a list with its QR payload and never the signed pass link', () => {
    const c = applyList(emptyCache('u1'), 'upcoming', [ticket('a'), ticket('b')], t0);
    const got = listFrom(c, 'upcoming');
    expect(got?.tickets.map((t) => t.id)).toEqual(['a', 'b']);
    expect(got?.tickets[0]?.qrToken).toBe('oc1.token');
    expect(got?.tickets.every((t) => t.passUrl === null)).toBe(true);
    expect(got?.savedAt).toBe(t0.toISOString());
    expect(listFrom(c, 'past')).toBeNull();
  });

  it('survives a JSON round trip for the same user only', () => {
    const c = applyList(emptyCache('u1'), 'upcoming', [ticket('a')], t0);
    const raw = serialize(c);
    expect(parseCache(raw, 'u1')).toEqual(c);
    expect(parseCache(raw, 'u2')).toBeNull();
    expect(parseCache('{not json', 'u1')).toBeNull();
    expect(parseCache(null, 'u1')).toBeNull();
    expect(parseCache(JSON.stringify({ ...c, v: 2 }), 'u1')).toBeNull();
  });

  it('refreshing a list drops tickets that left it but keeps ones the other list holds', () => {
    let c = applyList(emptyCache('u1'), 'upcoming', [ticket('a'), ticket('b')], t0);
    c = applyList(c, 'past', [ticket('z')], t0);
    c = applyList(c, 'upcoming', [ticket('b')], t1);
    expect(ticketFrom(c, 'a')).toBeNull();
    expect(ticketFrom(c, 'b')?.savedAt).toBe(t1.toISOString());
    expect(ticketFrom(c, 'z')).not.toBeNull();
  });

  it('stores a single ticket read on its own and finds it by id', () => {
    const c = applyTicket(emptyCache('u1'), ticket('solo'), t1);
    expect(ticketFrom(c, 'solo')).toMatchObject({ savedAt: t1.toISOString() });
    expect(ticketFrom(c, 'other')).toBeNull();
    expect(listFrom(c, 'upcoming')).toBeNull();
  });

  it('treats only no-connection and server errors as offline', () => {
    expect(isOfflineError({ status: 0 })).toBe(true);
    expect(isOfflineError({ status: 503 })).toBe(true);
    expect(isOfflineError({ status: 404 })).toBe(false);
    expect(isOfflineError({ status: 401 })).toBe(false);
    expect(isOfflineError(new Error('x'))).toBe(false);
  });
});
