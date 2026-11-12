import { type PublicTickets, PublicTicketsSchema } from '@/lib/shared';
import { bffHeaders, type Client } from './bff';
import { apiUrl } from './env';

/** Link tokens are `ol1.<uuid>.<mac>`; anything else cannot be genuine, so the API is not asked. */
const TOKEN_SHAPE = /^[A-Za-z0-9_.-]{10,300}$/;

export type GuestLoad =
  | { kind: 'ok'; data: PublicTickets }
  | { kind: 'missing' }
  | { kind: 'unavailable' };

/** Public read of a guest's tickets by link token. Never throws: the page always has something to say. */
export async function loadGuestTickets(token: string, client: Client): Promise<GuestLoad> {
  if (!TOKEN_SHAPE.test(token)) return { kind: 'missing' };
  try {
    const res = await fetch(`${apiUrl()}/v1/t/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      headers: bffHeaders(client),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return { kind: 'missing' };
    if (!res.ok) return { kind: 'unavailable' };
    const parsed = PublicTicketsSchema.safeParse(await res.json());
    return parsed.success ? { kind: 'ok', data: parsed.data } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Apple Wallet only exists on Apple devices; elsewhere the button would download a dead file. */
export function isAppleDevice(userAgent: string | null): boolean {
  return userAgent !== null && /iPhone|iPad|iPod|Macintosh/.test(userAgent);
}

export const mapLink = (lat: number, lng: number): string =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/** Where the "Add to Wallet" button goes. The signed pass URL is minted there, at tap time. */
export const walletHref = (token: string, ticketId: string): string =>
  `/t/${encodeURIComponent(token)}/pass/${ticketId}`;
