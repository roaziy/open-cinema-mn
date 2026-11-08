import { z } from 'zod';
import { SeatMapShowtimeSchema } from './catalog';

export const HoldSchema = z.object({
  id: z.string(),
  seatId: z.string(),
  showtimeId: z.string(),
  expiresAt: z.string(),
});
export type Hold = z.infer<typeof HoldSchema>;

export const HoldCreateBody = z.object({
  seatIds: z.array(z.string().uuid()).min(1).max(10),
});
export type HoldCreateBody = z.infer<typeof HoldCreateBody>;

export const BookingCreateBody = z.object({
  holdIds: z.array(z.string().uuid()).min(1).max(10),
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
  status: BookingStatusSchema,
  total: z.number().int(),
  expiresAt: z.string(),
  seatsLost: z.boolean(),
  invoice: InvoiceSchema.nullable(),
  ticketIds: z.array(z.string()),
  showtime: SeatMapShowtimeSchema,
});
export type BookingView = z.infer<typeof BookingViewSchema>;
