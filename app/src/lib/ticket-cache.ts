import type { TicketView } from '@open-cinema/shared';
import { Directory, File, Paths } from 'expo-file-system';
import {
  applyList,
  applyTicket,
  emptyCache,
  parseCache,
  type Scope,
  serialize,
  type TicketCache,
} from './ticket-cache-core';

/**
 * Persists the cache as one JSON file per user in the app's document directory (kept across
 * restarts, never in the OS-managed cache). Every failure is swallowed: the cache is a
 * convenience, never a reason for a screen to break.
 */
const dir = () => new Directory(Paths.document, 'ticket-cache');
const fileFor = (userId: string) => new File(dir(), `${encodeURIComponent(userId)}.json`);

const memory = new Map<string, TicketCache>();
// Writes are serialized so an older snapshot can never overwrite a newer one.
let chain: Promise<void> = Promise.resolve();

export async function loadCache(userId: string): Promise<TicketCache> {
  const hit = memory.get(userId);
  if (hit) return hit;
  let cache: TicketCache | null = null;
  try {
    const f = fileFor(userId);
    if (f.exists) cache = parseCache(await f.text(), userId);
  } catch {}
  const value = cache ?? emptyCache(userId);
  memory.set(userId, value);
  return value;
}

function persist(userId: string, cache: TicketCache): void {
  memory.set(userId, cache);
  chain = chain.then(() => {
    try {
      dir().create({ intermediates: true, idempotent: true });
      const f = fileFor(userId);
      f.create({ overwrite: true, intermediates: true });
      f.write(serialize(cache));
    } catch {}
  });
}

export async function saveList(
  userId: string,
  scope: Scope,
  list: TicketView[],
  now = new Date(),
): Promise<void> {
  persist(userId, applyList(await loadCache(userId), scope, list, now));
}

export async function saveTicket(userId: string, ticket: TicketView, now = new Date()) {
  persist(userId, applyTicket(await loadCache(userId), ticket, now));
}

/** Forgets every stored ticket (logout, or a different user signing in). */
export function clearTicketCache(): Promise<void> {
  memory.clear();
  chain = chain.then(() => {
    try {
      const d = dir();
      if (d.exists) d.delete();
    } catch {}
  });
  return chain;
}
