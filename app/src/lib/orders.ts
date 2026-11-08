import {
  type BookingView,
  BookingViewSchema,
  type TicketView,
  TicketViewSchema,
} from '@open-cinema/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';

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
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'pending' ? false : 2500),
    staleTime: 0,
  });
}

const ticketList = TicketViewSchema.array();

export async function fetchTicket(id: string): Promise<TicketView> {
  return TicketViewSchema.parse(await api(`/tickets/${id}`));
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: orderKeys.ticket(id),
    queryFn: () => fetchTicket(id),
    staleTime: 0,
  });
}

export function useTickets(scope: 'upcoming' | 'past') {
  const { ready, user } = useAuth();
  return useQuery({
    queryKey: orderKeys.tickets(user?.id ?? null, scope),
    queryFn: async (): Promise<TicketView[]> =>
      ticketList.parse(await api(`/me/tickets?scope=${scope}`)),
    enabled: ready && !!user,
    staleTime: 0,
  });
}
