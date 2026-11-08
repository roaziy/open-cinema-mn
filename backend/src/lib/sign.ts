import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

const mac = (payload: string, secret: string = env.QR_SECRET): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Ticket QR payload: `oc1.<ticketId>.<showtimeId>.<mac>`. Ids are UUIDs, so they hold no dots. */
export function signQr(ticketId: string, showtimeId: string): string {
  const body = `oc1.${ticketId}.${showtimeId}`;
  return `${body}.${mac(body)}`;
}

/** Returns the ids when the token carries a valid signature, else null. */
export function verifyQr(token: string): { ticketId: string; showtimeId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'oc1') return null;
  const [, ticketId, showtimeId, given] = parts as [string, string, string, string];
  if (!safeEqual(given, mac(`oc1.${ticketId}.${showtimeId}`))) return null;
  return { ticketId, showtimeId };
}

/** Guest ticket link token: `ol1.<bookingId>.<mac>`, signed with LINK_SECRET (not the QR secret). */
export function signLink(bookingId: string): string {
  const body = `ol1.${bookingId}`;
  return `${body}.${mac(body, env.LINK_SECRET)}`;
}

/** Returns the booking id when the link token is genuine, else null. */
export function verifyLink(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'ol1') return null;
  const [, bookingId, given] = parts as [string, string, string];
  return safeEqual(given, mac(`ol1.${bookingId}`, env.LINK_SECRET)) ? bookingId : null;
}

export const PASS_URL_TTL_SECONDS = 300;

// The prefix keeps pass signatures apart from QR tokens, which share the secret.
const passMac = (ticketId: string, exp: number) => mac(`pass.${ticketId}.${exp}`);

/** Relative, short-lived URL for a ticket's `.pkpass`. */
export function signPassUrl(ticketId: string, now: Date): string {
  const exp = Math.floor(now.getTime() / 1000) + PASS_URL_TTL_SECONDS;
  return `/v1/tickets/${ticketId}/pass?exp=${exp}&sig=${passMac(ticketId, exp)}`;
}

export function verifyPassSig(ticketId: string, exp: number, sig: string, now: Date): boolean {
  if (!Number.isInteger(exp) || exp < Math.floor(now.getTime() / 1000)) return false;
  return safeEqual(sig, passMac(ticketId, exp));
}
