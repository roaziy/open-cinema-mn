import { z } from 'zod';
import { SeatKindSchema } from './admin';
import { BookingStatusSchema } from './booking';
import {
  BranchSchema,
  MovieSummarySchema,
  SeatMapShowtimeSchema,
  ShowtimeFormatSchema,
} from './catalog';

export const TicketViewSchema = z.object({
  id: z.string(),
  bookingId: z.string(),
  orderNo: z.string(),
  status: z.enum(['valid', 'cancelled']),
  usedAt: z.string().nullable(),
  seat: z.object({ rowLabel: z.string(), number: z.number().int(), kind: SeatKindSchema }),
  hallName: z.string(),
  showtime: z.object({ id: z.string(), startsAt: z.string(), format: ShowtimeFormatSchema }),
  movie: MovieSummarySchema,
  branch: BranchSchema,
  qrToken: z.string(),
  /** 4 characters printed next to the order number; a door that types the order needs it too. */
  checkCode: z.string(),
  passUrl: z.string().nullable(),
});
export type TicketView = z.infer<typeof TicketViewSchema>;

/** Response of the public `GET /t/:linkToken`: no contact details, no invoice. */
export const PublicTicketsSchema = z.object({
  booking: z.object({
    orderNo: z.string(),
    status: BookingStatusSchema,
    total: z.number().int(),
    showtime: SeatMapShowtimeSchema,
  }),
  tickets: z.array(TicketViewSchema),
});
export type PublicTickets = z.infer<typeof PublicTicketsSchema>;

/** `GET /t/:linkToken/pass/:ticketId` response: where the Wallet pass can be fetched. */
export const PassUrlResponseSchema = z.object({ url: z.string() });
export type PassUrlResponse = z.infer<typeof PassUrlResponseSchema>;
