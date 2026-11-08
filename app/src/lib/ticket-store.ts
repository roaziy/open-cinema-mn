import type { TicketView } from '@open-cinema/shared';
import {
  applyList,
  applyTicket,
  emptyCache,
  parseCache,
  type Scope,
  serialize,
  type TicketCache,
} from './ticket-cache-core';

/** The few file operations the store needs, so tests can use a fake disk. */
export type CacheFs = {
  /** File names in the cache directory (empty when it does not exist). */
  list(): string[];
  read(name: string): Promise<string | null>;
  /** Writes the file, creating the directory when needed. */
  write(name: string, content: string): void;
  remove(name: string): void;
  /** Deletes the whole cache directory. */
  removeAll(): void;
};

export const fileNameFor = (userId: string) => `${encodeURIComponent(userId)}.json`;

/**
 * Stored tickets, one file per user. A ticket cache must never outlive its account:
 * - `clear()` bumps a generation, so any save that began earlier is dropped, even one whose
 *   network call finishes after the logout;
 * - a queued write also re-checks that the same user is still signed in when it runs;
 * - `sweep()` deletes every file that is not the current user's (all of them with no session),
 *   which covers an app killed in the middle of a clear.
 * Every disk failure is swallowed: the cache is a convenience, never a reason for a screen to break.
 */
export function createTicketStore(fs: CacheFs, currentUserId: () => string | null) {
  const memory = new Map<string, TicketCache>();
  let generation = 0;
  // Disk work runs in order, so an older snapshot can never overwrite a newer one.
  let chain: Promise<void> = Promise.resolve();
  const swept = new Set<string | null>();

  const queue = (task: () => void) => {
    chain = chain.then(() => {
      try {
        task();
      } catch {}
    });
    return chain;
  };

  function sweep(userId: string | null): Promise<void> {
    swept.add(userId);
    for (const id of [...memory.keys()]) if (id !== userId) memory.delete(id);
    return queue(() => {
      if (userId === null) return fs.removeAll();
      const keep = fileNameFor(userId);
      for (const name of fs.list()) if (name !== keep) fs.remove(name);
    });
  }

  async function load(userId: string): Promise<TicketCache> {
    if (!swept.has(userId)) void sweep(userId);
    const hit = memory.get(userId);
    if (hit) return hit;
    let cache: TicketCache | null = null;
    try {
      cache = parseCache(await fs.read(fileNameFor(userId)), userId);
    } catch {}
    const value = cache ?? emptyCache(userId);
    // A clear while reading: the stored copy is not ours to hand out any more.
    if (currentUserId() !== userId) return emptyCache(userId);
    memory.set(userId, value);
    return value;
  }

  async function save(userId: string, update: (c: TicketCache) => TicketCache): Promise<void> {
    const started = generation;
    const next = update(await load(userId));
    const current = () => generation === started && currentUserId() === userId;
    if (!current()) return;
    memory.set(userId, next);
    await queue(() => {
      if (current()) fs.write(fileNameFor(userId), serialize(next));
    });
  }

  return {
    load,
    saveList: (userId: string, scope: Scope, list: TicketView[], now = new Date()) =>
      save(userId, (c) => applyList(c, scope, list, now)),
    saveTicket: (userId: string, ticket: TicketView, now = new Date()) =>
      save(userId, (c) => applyTicket(c, ticket, now)),
    /** Forgets every stored ticket (logout, or a different user signing in). */
    clear(): Promise<void> {
      generation++;
      memory.clear();
      swept.clear();
      return queue(() => fs.removeAll());
    },
    /** Deletes every file that does not belong to `userId`; all of them when it is null. */
    sweep,
  };
}
