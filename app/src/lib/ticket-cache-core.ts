import { type TicketView, TicketViewSchema } from '@open-cinema/shared';
import { z } from 'zod';

/**
 * The tickets a signed-in user has already loaded, kept so the QR still shows with no signal
 * (a door queue, a cinema basement). Pure data handling; the file IO lives in `ticket-cache.ts`.
 */
export type Scope = 'upcoming' | 'past';

const CacheSchema = z.object({
  v: z.literal(1),
  userId: z.string(),
  tickets: z.record(z.string(), TicketViewSchema),
  /** Ticket ids per list, in the order the server gave them, and when that list was read. */
  scopes: z.object({
    upcoming: z.object({ ids: z.array(z.string()), savedAt: z.string() }).optional(),
    past: z.object({ ids: z.array(z.string()), savedAt: z.string() }).optional(),
  }),
  /** When a single ticket was last read, for the ones not in a list. */
  ticketSavedAt: z.record(z.string(), z.string()),
});
export type TicketCache = z.infer<typeof CacheSchema>;

/** The signed pass link is short-lived: it is never kept. */
const stripped = (t: TicketView): TicketView => ({ ...t, passUrl: null });

export const emptyCache = (userId: string): TicketCache => ({
  v: 1,
  userId,
  tickets: {},
  scopes: {},
  ticketSavedAt: {},
});

/** Replaces one list. Tickets that were only in the old version of that list are dropped. */
export function applyList(
  cache: TicketCache,
  scope: Scope,
  list: TicketView[],
  now: Date,
): TicketCache {
  const other = scope === 'upcoming' ? 'past' : 'upcoming';
  const keep = new Set([...list.map((t) => t.id), ...(cache.scopes[other]?.ids ?? [])]);
  const dropped = new Set((cache.scopes[scope]?.ids ?? []).filter((id) => !keep.has(id)));
  const tickets = Object.fromEntries(
    Object.entries(cache.tickets).filter(([id]) => !dropped.has(id)),
  );
  const ticketSavedAt = Object.fromEntries(
    Object.entries(cache.ticketSavedAt).filter(([id]) => !dropped.has(id)),
  );
  for (const t of list) {
    tickets[t.id] = stripped(t);
    ticketSavedAt[t.id] = now.toISOString();
  }
  return {
    ...cache,
    tickets,
    ticketSavedAt,
    scopes: {
      ...cache.scopes,
      [scope]: { ids: list.map((t) => t.id), savedAt: now.toISOString() },
    },
  };
}

/** Stores one ticket read on its own (the ticket screen). */
export function applyTicket(cache: TicketCache, ticket: TicketView, now: Date): TicketCache {
  return {
    ...cache,
    tickets: { ...cache.tickets, [ticket.id]: stripped(ticket) },
    ticketSavedAt: { ...cache.ticketSavedAt, [ticket.id]: now.toISOString() },
  };
}

export function listFrom(
  cache: TicketCache,
  scope: Scope,
): { tickets: TicketView[]; savedAt: string } | null {
  const entry = cache.scopes[scope];
  if (!entry) return null;
  const tickets = entry.ids.flatMap((id) => cache.tickets[id] ?? []);
  return { tickets, savedAt: entry.savedAt };
}

export function ticketFrom(
  cache: TicketCache,
  id: string,
): { ticket: TicketView; savedAt: string } | null {
  const ticket = cache.tickets[id];
  const savedAt = cache.ticketSavedAt[id];
  return ticket && savedAt ? { ticket, savedAt } : null;
}

export function serialize(cache: TicketCache): string {
  return JSON.stringify(cache);
}

/** The stored cache for this user, or null when it is missing, damaged, or another user's. */
export function parseCache(raw: string | null, userId: string): TicketCache | null {
  if (!raw) return null;
  try {
    const parsed = CacheSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.userId === userId ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A failed read that means "no connection or server down", as opposed to "not allowed / not found". */
export function isOfflineError(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' && (status === 0 || status >= 500);
}
