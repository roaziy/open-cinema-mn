import type { TicketView } from '@open-cinema/shared';
import { describe, expect, it } from 'vitest';
import { listFrom, parseCache } from './ticket-cache-core';
import { type CacheFs, createTicketStore, fileNameFor } from './ticket-store';

const ticket = (id: string): TicketView =>
  ({
    id,
    bookingId: 'b',
    orderNo: 'OC-1',
    status: 'valid',
    usedAt: null,
    seat: { rowLabel: 'F', number: 1, kind: 'standard' },
    hallName: 'H',
    showtime: { id: 's', startsAt: '2026-11-08T11:00:00.000Z', format: '2D' },
    movie: {
      id: 'm',
      title: 'M',
      posterUrl: 'p',
      backdropUrl: null,
      tone: '#2E6BF0',
      ageRating: '12+',
      durationMin: 90,
      genres: [],
      status: 'now',
      releaseDate: '2026-11-01',
    },
    branch: { id: 'br', name: 'B', address: 'a', lat: 1, lng: 1 },
    qrToken: 'oc1.t',
    checkCode: 'AAAA',
    passUrl: null,
  }) as TicketView;

function fakeDisk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const fs: CacheFs = {
    list: () => [...files.keys()],
    read: async (n) => files.get(n) ?? null,
    write: (n, c) => void files.set(n, c),
    remove: (n) => void files.delete(n),
    removeAll: () => files.clear(),
  };
  return { files, fs };
}

const stored = (userId: string) =>
  JSON.stringify({
    v: 1,
    userId,
    tickets: { a: ticket('a') },
    scopes: { upcoming: { ids: ['a'], savedAt: '2026-11-08T05:00:00.000Z' } },
    ticketSavedAt: { a: '2026-11-08T05:00:00.000Z' },
  });

describe('ticket store', () => {
  it('persists a list for the signed-in user and reads it back after a restart', async () => {
    const disk = fakeDisk();
    const store = createTicketStore(disk.fs, () => 'A');
    await store.saveList('A', 'upcoming', [ticket('a')]);
    expect(parseCache(disk.files.get(fileNameFor('A')) ?? null, 'A')).not.toBeNull();
    const again = createTicketStore(disk.fs, () => 'A');
    expect(listFrom(await again.load('A'), 'upcoming')?.tickets.map((t) => t.id)).toEqual(['a']);
  });

  it('drops a save that started before a clear, even if its network call finished after', async () => {
    const disk = fakeDisk();
    let user: string | null = 'A';
    const store = createTicketStore(disk.fs, () => user);
    // The read of the cache is still pending when the user logs out.
    const slow = createTicketStore(
      { ...disk.fs, read: () => new Promise((r) => setTimeout(() => r(null), 20)) },
      () => user,
    );
    const pending = slow.saveList('A', 'upcoming', [ticket('a')]);
    user = null;
    await slow.clear();
    await pending;
    expect(disk.files.size).toBe(0);

    // Same with the generation alone: signed in again as the same user after the clear.
    user = 'A';
    const racing = store.saveList('A', 'upcoming', [ticket('a')]);
    await store.clear();
    await racing;
    expect(disk.files.size).toBe(0);
  });

  it('does not write for a user who is no longer signed in when the write runs', async () => {
    const disk = fakeDisk();
    let user: string | null = 'A';
    const store = createTicketStore(disk.fs, () => user);
    const saving = store.saveTicket('A', ticket('a'));
    user = 'B';
    await saving;
    expect(disk.files.size).toBe(0);
  });

  it('sweep with no session removes every file', async () => {
    const disk = fakeDisk({ [fileNameFor('A')]: stored('A'), [fileNameFor('B')]: stored('B') });
    await createTicketStore(disk.fs, () => null).sweep(null);
    expect(disk.files.size).toBe(0);
  });

  it("sweep as user B removes A's file and keeps B's", async () => {
    const disk = fakeDisk({ [fileNameFor('A')]: stored('A'), [fileNameFor('B')]: stored('B') });
    await createTicketStore(disk.fs, () => 'B').sweep('B');
    expect([...disk.files.keys()]).toEqual([fileNameFor('B')]);
  });

  it("loading a user's cache also removes other accounts' leftovers", async () => {
    const disk = fakeDisk({ [fileNameFor('A')]: stored('A'), [fileNameFor('B')]: stored('B') });
    const store = createTicketStore(disk.fs, () => 'B');
    expect(listFrom(await store.load('B'), 'upcoming')).not.toBeNull();
    await store.sweep('B');
    expect([...disk.files.keys()]).toEqual([fileNameFor('B')]);
  });
});
