import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

const mac = (payload: string): string =>
  createHmac('sha256', env.QR_SECRET).update(payload).digest('base64url');

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
  const expected = Buffer.from(mac(`oc1.${ticketId}.${showtimeId}`));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { ticketId, showtimeId };
}
