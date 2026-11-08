import { z } from 'zod';
import { SeatKindSchema } from './admin';
import { BranchSchema, MovieSummarySchema, ShowtimeFormatSchema } from './catalog';

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
  passUrl: z.string().nullable(),
});
export type TicketView = z.infer<typeof TicketViewSchema>;
