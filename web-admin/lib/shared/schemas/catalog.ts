import { z } from 'zod';
import { SeatKindSchema } from './admin';

export const BranchSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
});
export type Branch = z.infer<typeof BranchSchema>;

export const MovieSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  posterUrl: z.string(),
  backdropUrl: z.string().nullable(),
  tone: z.string(),
  ageRating: z.string(),
  durationMin: z.number().int(),
  genres: z.array(z.string()),
  status: z.enum(['now', 'soon']),
  releaseDate: z.string(),
});
export type MovieSummary = z.infer<typeof MovieSummarySchema>;

export const MovieDetailSchema = MovieSummarySchema.extend({
  synopsis: z.string(),
  trailerUrl: z.string().nullable(),
});
export type MovieDetail = z.infer<typeof MovieDetailSchema>;

export const ShowtimeFormatSchema = z.enum(['2D', '3D', 'IMAX']);
export type ShowtimeFormat = z.infer<typeof ShowtimeFormatSchema>;

export const ShowtimeSlotSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  format: ShowtimeFormatSchema,
  priceStandard: z.number().int(),
  pricePremium: z.number().int(),
  seatsLeft: z.number().int(),
  capacity: z.number().int(),
  hallName: z.string(),
});
export type ShowtimeSlot = z.infer<typeof ShowtimeSlotSchema>;

export const BranchShowtimesSchema = z.object({
  branch: BranchSchema,
  showtimes: z.array(ShowtimeSlotSchema),
});
export type BranchShowtimes = z.infer<typeof BranchShowtimesSchema>;

export const SeatStateValueSchema = z.enum(['free', 'held', 'sold']);
export type SeatStateValue = z.infer<typeof SeatStateValueSchema>;

export const SeatStateSchema = z.object({
  id: z.string(),
  rowLabel: z.string(),
  number: z.number().int(),
  x_m: z.number(),
  y_m: z.number(),
  z_m: z.number(),
  kind: SeatKindSchema,
  state: SeatStateValueSchema,
});
export type SeatState = z.infer<typeof SeatStateSchema>;

export const SeatMapShowtimeSchema = ShowtimeSlotSchema.extend({
  movie: MovieSummarySchema,
  branch: BranchSchema,
  status: z.string(),
});
export type SeatMapShowtime = z.infer<typeof SeatMapShowtimeSchema>;

export const SeatMapSchema = z.object({
  showtime: SeatMapShowtimeSchema,
  hall: z.object({
    id: z.string(),
    name: z.string(),
    screen_width_m: z.number(),
    screen_height_m: z.number(),
    screen_x_m: z.number(),
  }),
  seats: z.array(SeatStateSchema),
});
export type SeatMap = z.infer<typeof SeatMapSchema>;

export const SeatDeltaSchema = z.object({
  seatId: z.string(),
  state: SeatStateValueSchema,
});
export type SeatDelta = z.infer<typeof SeatDeltaSchema>;
