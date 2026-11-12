import { useQuery } from '@tanstack/react-query';
import { type BookingView, BookingViewSchema, type TicketView, TicketViewSchema } from '@/shared';
import { ApiError, api } from './api';
import { getUserId, useAuth } from './auth';
import { loadCache, saveList, saveTicket } from './ticket-cache';
import { isOfflineError, listFrom, ticketFrom } from './ticket-cache-core';

export const orderKeys = {
  booking: (id: string) => ['booking', id] as const,
  tickets: (userId: string | null, scope: 'upcoming' | 'past') =>
    ['tickets', userId, scope] as const,
  ticket: (id: string) => ['ticket', id] as const,
};

/** RFC 4122 v4. The key only has to be unique per attempt, so Math.random is enough. */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

export async function createBooking(args: {
  holdIds: string[];
  idempotencyKey: string;
  contactEmail?: string;
}): Promise<BookingView> {
  return BookingViewSchema.parse(await api('/bookings', { method: 'POST', json: args }));
}

export async function mockPay(bookingId: string): Promise<BookingView> {
  return BookingViewSchema.parse(await api(`/bookings/${bookingId}/mock-pay`, { method: 'POST' }));
}

/** The booking, re-read every 2.5 s while it is pending (each read also checks the invoice). */
export function useBooking(id: string) {
  return useQuery({
    queryKey: orderKeys.booking(id),
    queryFn: async (): Promise<BookingView> =>
      BookingViewSchema.parse(await api(`/bookings/${id}`)),
    enabled: !!id,
    // Settled, or the booking is not ours / does not exist: nothing more to wait for.
    refetchInterval: (q) => {
      if (q.state.data && q.state.data.status !== 'pending') return false;
      const e = q.state.error;
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) return false;
      return 2500;
    },
    staleTime: 0,
  });
}

const ticketList = TicketViewSchema.array();

/** The signed pass link is short-lived: it is fetched fresh when Wallet is pressed, never kept. */
const withoutPassUrl = (t: TicketView): TicketView => ({ ...t, passUrl: null });

export async function fetchTicket(id: string): Promise<TicketView> {
  return TicketViewSchema.parse(await api(`/tickets/${id}`));
}

/** Data served from the stored copy (no connection), mapped to when that copy was read. */
const offlineCopies = new WeakMap<object, string>();

/** When the stored copy behind `data` was last read from the server, or null for live data. */
export function offlineSince(data: object | undefined): string | null {
  return (data && offlineCopies.get(data)) ?? null;
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: orderKeys.ticket(id),
    queryFn: async () => {
      const userId = getUserId();
      try {
        const ticket = withoutPassUrl(await fetchTicket(id));
        if (userId) void saveTicket(userId, ticket);
        return ticket;
      } catch (e) {
        // No signal: the QR comes from the copy stored when the ticket was last seen.
        const stored = userId && isOfflineError(e) ? ticketFrom(await loadCache(userId), id) : null;
        if (!stored) throw e;
        offlineCopies.set(stored.ticket, stored.savedAt);
        return stored.ticket;
      }
    },
    staleTime: 0,
    // Identity matters here: a stored copy is recognised by its object.
    structuralSharing: false,
  });
}

export function useTickets(scope: 'upcoming' | 'past') {
  const { ready, user } = useAuth();
  return useQuery({
    queryKey: orderKeys.tickets(user?.id ?? null, scope),
    queryFn: async (): Promise<TicketView[]> => {
      const userId = getUserId();
      try {
        const list = ticketList.parse(await api(`/me/tickets?scope=${scope}`)).map(withoutPassUrl);
        if (userId) void saveList(userId, scope, list);
        return list;
      } catch (e) {
        const stored =
          userId && isOfflineError(e) ? listFrom(await loadCache(userId), scope) : null;
        if (!stored) throw e;
        offlineCopies.set(stored.tickets, stored.savedAt);
        return stored.tickets;
      }
    },
    enabled: ready && !!user,
    staleTime: 0,
    structuralSharing: false,
  });
}
