import { z } from 'zod';

/** `GET /v1/staff/today` rows: today's showtimes with door progress. */
export const TodayShowtimeSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  hallName: z.string(),
  movieTitle: z.string(),
  posterUrl: z.string(),
  tone: z.string(),
  admitted: z.number(),
  sold: z.number(),
  capacity: z.number(),
});
export type TodayShowtime = z.infer<typeof TodayShowtimeSchema>;
