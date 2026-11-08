import { z } from 'zod';

export const SeatKindSchema = z.enum(['standard', 'premium', 'wheelchair', 'blocked']);
export type SeatKind = z.infer<typeof SeatKindSchema>;

export const HallGenParams = z.object({
  rows: z.number().int().min(1).max(52),
  seatsPerRow: z.number().int().min(1).max(60),
  seatPitchM: z.number().positive().max(2),
  rowSpacingM: z.number().positive().max(3),
  aisleAfter: z.array(z.number().int().min(1)),
  firstRowDistanceM: z.number().min(0).max(40),
  risePerRowM: z.number().min(0).max(1),
});
export type HallGenParams = z.infer<typeof HallGenParams>;

// ---------------------------------------------------------------------------------------------
// Admin API (/v1/admin). Requests are `*Body` / `*Query`, responses are `*Schema`.
// ---------------------------------------------------------------------------------------------

const Uuid = z.string().uuid();
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const IsoInstant = z.string().datetime({ offset: true });
/** Ulaanbaatar calendar date, YYYY-MM-DD. */
export const UbDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    // Out-of-range parts make Date invalid (toISOString would throw); overflow (02-30) rolls over.
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, 'not a real date');
const HttpUrl = z
  .string()
  .max(1000)
  .regex(/^https?:\/\/[^\s/][^\s]*$/i, 'must be an http(s) URL');
const PriceMnt = z.number().int().positive().max(10_000_000);

export const AdminBranchBody = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type AdminBranchBody = z.infer<typeof AdminBranchBody>;
export const AdminBranchPatch = AdminBranchBody.partial();
export type AdminBranchPatch = z.infer<typeof AdminBranchPatch>;

export const AdminHallBody = z.object({
  branchId: Uuid,
  name: z.string().trim().min(1).max(120),
  screen_width_m: z.number().positive().max(40),
  screen_height_m: z.number().positive().max(20),
  gen: HallGenParams,
});
export type AdminHallBody = z.infer<typeof AdminHallBody>;

export const AdminHallPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  screen_width_m: z.number().positive().max(40).optional(),
  screen_height_m: z.number().positive().max(20).optional(),
});
export type AdminHallPatch = z.infer<typeof AdminHallPatch>;

export const AdminHallRegenerateBody = z.object({ gen: HallGenParams });
export type AdminHallRegenerateBody = z.infer<typeof AdminHallRegenerateBody>;

export const AdminSeatChangesBody = z.object({
  changes: z
    .array(z.object({ seatId: Uuid, kind: SeatKindSchema }))
    .min(1)
    .max(3200),
});
export type AdminSeatChangesBody = z.infer<typeof AdminSeatChangesBody>;

export const AdminHallListQuery = z.object({ branchId: Uuid.optional() });

export const AdminHallSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  name: z.string(),
  screen_width_m: z.number(),
  screen_height_m: z.number(),
  screen_x_m: z.number(),
  seatCount: z.number().int(),
  /** True once any ticket was ever issued for one of the hall's seats: it cannot be regenerated. */
  locked: z.boolean(),
});
export type AdminHall = z.infer<typeof AdminHallSchema>;

export const AdminSeatSchema = z.object({
  id: z.string(),
  rowLabel: z.string(),
  number: z.number().int(),
  x_m: z.number(),
  y_m: z.number(),
  z_m: z.number(),
  kind: SeatKindSchema,
});
export type AdminSeat = z.infer<typeof AdminSeatSchema>;

export const AdminHallDetailSchema = AdminHallSchema.extend({ seats: z.array(AdminSeatSchema) });
export type AdminHallDetail = z.infer<typeof AdminHallDetailSchema>;

export const AdminMovieBody = z.object({
  title: z.string().trim().min(1).max(200),
  synopsis: z.string().max(5000).default(''),
  durationMin: z.number().int().min(1).max(600),
  ageRating: z.string().trim().min(1).max(10),
  genres: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  posterUrl: HttpUrl,
  backdropUrl: HttpUrl.nullable().default(null),
  trailerUrl: HttpUrl.nullable().default(null),
  tone: Hex.default('#2E6BF0'),
  releaseDate: UbDate,
  status: z.enum(['now', 'soon', 'archived']).default('soon'),
});
export type AdminMovieBody = z.infer<typeof AdminMovieBody>;
// Partial without the defaults: a PATCH must only touch the fields it names.
export const AdminMoviePatch = z
  .object({
    title: AdminMovieBody.shape.title,
    synopsis: z.string().max(5000),
    durationMin: AdminMovieBody.shape.durationMin,
    ageRating: AdminMovieBody.shape.ageRating,
    genres: z.array(z.string().trim().min(1).max(40)).max(10),
    posterUrl: HttpUrl,
    backdropUrl: HttpUrl.nullable(),
    trailerUrl: HttpUrl.nullable(),
    tone: Hex,
    releaseDate: UbDate,
    status: z.enum(['now', 'soon', 'archived']),
  })
  .partial();
export type AdminMoviePatch = z.infer<typeof AdminMoviePatch>;

export const AdminMovieSchema = z.object({
  id: z.string(),
  title: z.string(),
  synopsis: z.string(),
  durationMin: z.number().int(),
  ageRating: z.string(),
  genres: z.array(z.string()),
  posterUrl: z.string(),
  backdropUrl: z.string().nullable(),
  trailerUrl: z.string().nullable(),
  tone: z.string(),
  releaseDate: z.string(),
  status: z.enum(['now', 'soon', 'archived']),
});
export type AdminMovie = z.infer<typeof AdminMovieSchema>;

export const UploadResultSchema = z.object({ url: z.string() });
export type UploadResult = z.infer<typeof UploadResultSchema>;

const ShowtimeFormat = z.enum(['2D', '3D', 'IMAX']);

export const AdminShowtimeBody = z.object({
  movieId: Uuid,
  hallId: Uuid,
  startsAt: IsoInstant,
  format: ShowtimeFormat.default('2D'),
  priceStandard: PriceMnt,
  pricePremium: PriceMnt,
});
export type AdminShowtimeBody = z.infer<typeof AdminShowtimeBody>;
export const AdminShowtimePatch = z
  .object({
    movieId: Uuid,
    hallId: Uuid,
    startsAt: IsoInstant,
    format: ShowtimeFormat,
    priceStandard: PriceMnt,
    pricePremium: PriceMnt,
  })
  .partial();
export type AdminShowtimePatch = z.infer<typeof AdminShowtimePatch>;

export const AdminShowtimeListQuery = z.object({
  branchId: Uuid.optional(),
  hallId: Uuid.optional(),
  movieId: Uuid.optional(),
  from: UbDate.optional(),
  to: UbDate.optional(),
});
export type AdminShowtimeListQuery = z.infer<typeof AdminShowtimeListQuery>;

export const AdminShowtimeSchema = z.object({
  id: z.string(),
  movieId: z.string(),
  movieTitle: z.string(),
  hallId: z.string(),
  hallName: z.string(),
  branchId: z.string(),
  branchName: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  format: ShowtimeFormat,
  priceStandard: z.number().int(),
  pricePremium: z.number().int(),
  status: z.enum(['scheduled', 'cancelled']),
  sold: z.number().int(),
  capacity: z.number().int(),
});
export type AdminShowtime = z.infer<typeof AdminShowtimeSchema>;

export const AdminShowtimeListSchema = z.object({
  items: z.array(AdminShowtimeSchema),
  /** True when more than the cap (500) matched; narrow the filters. */
  truncated: z.boolean(),
});
export type AdminShowtimeList = z.infer<typeof AdminShowtimeListSchema>;

export const ShowtimeCancelResultSchema = z.object({
  id: z.string(),
  status: z.literal('cancelled'),
  /** Paid bookings cancelled by this call; 0 when the showtime was already cancelled. */
  cancelledBookings: z.number().int(),
  cancelledTickets: z.number().int(),
  /** Integer MNT handed back to the paying customers (what was captured, not today's prices). */
  refundAmount: z.number().int(),
});
export type ShowtimeCancelResult = z.infer<typeof ShowtimeCancelResultSchema>;

/** `GET /admin/showtimes/:id/cancel-preview`: what confirming a cancellation would do. */
export const ShowtimeCancelPreviewSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  paidBookings: z.number().int(),
  tickets: z.number().int(),
  /** Sum of what the paid bookings actually paid. */
  refundAmount: z.number().int(),
  /** Unpaid bookings that will be expired. */
  pendingBookings: z.number().int(),
  /** Unexpired seat holds that will be dropped. */
  activeHolds: z.number().int(),
});
export type ShowtimeCancelPreview = z.infer<typeof ShowtimeCancelPreviewSchema>;

export const AdminStaffBody = z.object({
  phone: z.string().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  branchId: Uuid,
  /** Promote an existing customer with this phone instead of failing with `phone_in_use`. */
  convert: z.boolean().optional(),
});
export type AdminStaffBody = z.infer<typeof AdminStaffBody>;

export const AdminStaffSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
});
export type AdminStaff = z.infer<typeof AdminStaffSchema>;

export const AdminReportQuery = z
  .object({ from: UbDate, to: UbDate, branchId: Uuid.optional() })
  .refine((q) => q.from <= q.to, { message: 'from must not be after to', path: ['from'] });
export type AdminReportQuery = z.infer<typeof AdminReportQuery>;

export const AdminReportSchema = z.object({
  totals: z.object({
    revenue: z.number().int(),
    tickets: z.number().int(),
    /** Sold seats / capacity over scheduled showtimes, 0..1. */
    occupancy: z.number(),
  }),
  byDay: z.array(
    z.object({
      date: UbDate,
      revenue: z.number().int(),
      tickets: z.number().int(),
      occupancy: z.number(),
    }),
  ),
  byMovie: z.array(
    z.object({
      movieId: z.string(),
      title: z.string(),
      revenue: z.number().int(),
      tickets: z.number().int(),
      occupancy: z.number(),
    }),
  ),
  byHall: z.array(
    z.object({
      hallId: z.string(),
      hallName: z.string(),
      branchName: z.string(),
      revenue: z.number().int(),
      tickets: z.number().int(),
      occupancy: z.number(),
    }),
  ),
});
export type AdminReport = z.infer<typeof AdminReportSchema>;

export const AdminDashboardQuery = z.object({ branchId: Uuid.optional() });

const DayKpis = z.object({
  revenue: z.number().int(),
  tickets: z.number().int(),
  occupancy: z.number(),
});

export const AdminDashboardSchema = z.object({
  today: DayKpis,
  yesterday: DayKpis,
  refundsToday: z.object({ count: z.number().int(), amount: z.number().int() }),
  /** 24 entries, Ulaanbaatar hours 0..23. */
  hourlySales: z.array(
    z.object({ hour: z.number().int(), revenue: z.number().int(), tickets: z.number().int() }),
  ),
  topFilms: z.array(
    z.object({
      movieId: z.string(),
      title: z.string(),
      posterUrl: z.string(),
      tone: z.string(),
      revenue: z.number().int(),
      tickets: z.number().int(),
    }),
  ),
  upcoming: z.array(
    z.object({
      id: z.string(),
      startsAt: z.string(),
      movieTitle: z.string(),
      hallName: z.string(),
      branchName: z.string(),
      sold: z.number().int(),
      capacity: z.number().int(),
    }),
  ),
});
export type AdminDashboard = z.infer<typeof AdminDashboardSchema>;
