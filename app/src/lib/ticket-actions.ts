import type { TicketView } from '@open-cinema/shared';
import * as Calendar from 'expo-calendar';
import { Linking } from 'react-native';
import type { TKey } from '@/i18n';
import { fetchTicket } from './orders';

type T = (key: TKey, params?: Record<string, string | number>) => string;

export type ActionResult = { ok: true } | { ok: false; message: string };

/**
 * Open the signed .pkpass link. The link is short-lived, so it is fetched fresh on every
 * press and never kept; Safari then shows Apple's own add-to-Wallet sheet.
 */
export async function addToWallet(ticketId: string, t: T): Promise<ActionResult> {
  try {
    const fresh = await fetchTicket(ticketId);
    if (!fresh.passUrl) return { ok: false, message: t('ticket.walletOff') };
    await Linking.openURL(fresh.passUrl);
    return { ok: true };
  } catch {
    return { ok: false, message: t('ticket.walletFail') };
  }
}

export function ticketEventDetails(ticket: TicketView, t: T) {
  const start = new Date(ticket.showtime.startsAt);
  const seat = `${ticket.seat.rowLabel}${ticket.seat.number}`;
  return {
    title: ticket.movie.title,
    startDate: start,
    endDate: new Date(start.getTime() + ticket.movie.durationMin * 60_000),
    location: `${ticket.branch.name}, ${ticket.branch.address}`,
    notes: `${t('ticket.order', { no: ticket.orderNo })} · ${ticket.hallName} · ${t('ticket.seat')} ${seat}`,
    // Minutes relative to the start: negative = before.
    alarms: [{ relativeOffset: -30 }],
  };
}

/**
 * iOS: the system "new event" form, pre-filled with a 30-minute alarm; write-only access is
 * enough, the app never reads the calendar. Android: create the event in the first writable
 * calendar (needs the calendar permission).
 */
export async function addToCalendar(ticket: TicketView, t: T): Promise<ActionResult> {
  try {
    const details = ticketEventDetails(ticket, t);
    const perm = await Calendar.requestCalendarPermissions(true);
    if (!perm.granted) return { ok: false, message: t('ticket.calendarDenied') };

    if (process.env.EXPO_OS === 'ios') {
      const result = await Calendar.getDefaultCalendarSync().addEventWithForm(details);
      // Cancelling the form is the user's choice, not an error.
      return result.action === 'saved' || result.action === 'done'
        ? { ok: true }
        : { ok: false, message: '' };
    }
    const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    const target = calendars.find((c) => c.allowsModifications) ?? calendars[0];
    if (!target) return { ok: false, message: t('ticket.calendarFail') };
    await target.createEvent(details);
    return { ok: true };
  } catch {
    return { ok: false, message: t('ticket.calendarFail') };
  }
}
