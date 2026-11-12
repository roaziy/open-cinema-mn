import { z } from 'zod';
import { SeatMapShowtimeSchema } from './catalog';

/** At most this many seats in one booking. */
export const MAX_SEATS_PER_BOOKING = 10;
/** How long held seats stay held. */
export const HOLD_TTL_MS = 10 * 60_000;

/** Price of one seat: premium seats cost the premium price, every other kind the standard one. */
export function seatPrice(
  kind: string,
  prices: { priceStandard: number; pricePremium: number },
): number {
  return kind === 'premium' ? prices.pricePremium : prices.priceStandard;
}

export const HoldSchema = z.object({
  id: z.string(),
  seatId: z.string(),
  showtimeId: z.string(),
  expiresAt: z.string(),
  /** Set once the hold is inside an order; that order is still unpaid while the hold lives. */
  bookingId: z.string().nullable(),
});
export type Hold = z.infer<typeof HoldSchema>;

/** `POST /v1/holds` response. */
export const HoldsResponseSchema = z.object({ holds: z.array(HoldSchema) });
export type HoldsResponse = z.infer<typeof HoldsResponseSchema>;

export const HoldCreateBody = z.object({
  seatIds: z.array(z.string().uuid()).min(1).max(MAX_SEATS_PER_BOOKING),
});
export type HoldCreateBody = z.infer<typeof HoldCreateBody>;

export const BookingCreateBody = z.object({
  holdIds: z.array(z.string().uuid()).min(1).max(MAX_SEATS_PER_BOOKING),
  idempotencyKey: z.string().uuid(),
  contactEmail: z.string().email().optional(),
});
export type BookingCreateBody = z.infer<typeof BookingCreateBody>;

export const InvoiceSchema = z.object({
  invoiceId: z.string(),
  qrText: z.string(),
  deeplinks: z.array(z.object({ name: z.string(), url: z.string() })),
  expiresAt: z.string(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const BookingStatusSchema = z.enum(['pending', 'paid', 'failed', 'expired', 'cancelled']);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const BookingViewSchema = z.object({
  id: z.string(),
  orderNo: z.string(),
  status: BookingStatusSchema,
  total: z.number().int(),
  expiresAt: z.string(),
  seatsLost: z.boolean(),
  invoice: InvoiceSchema.nullable(),
  ticketIds: z.array(z.string()),
  showtime: SeatMapShowtimeSchema,
});
export type BookingView = z.infer<typeof BookingViewSchema>;
