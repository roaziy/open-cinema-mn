import { z } from 'zod';
import { UbDate } from './admin';

const ScanCommon = {
  scanId: z.string().uuid(),
  deviceId: z.string().uuid(),
  /** The door this phone was named after ("Хаалга 2"); shown to the next door that sees a repeat. */
  deviceLabel: z
    .string()
    .trim()
    .max(40)
    // No control or invisible formatting characters (NUL, bidi overrides): it is shown on a card.
    .refine((v) => !/[\p{Cc}\p{Cf}]/u.test(v), 'invalid_label')
    .optional()
    .transform((v) => (v ? v : undefined)),
};

/** A scanned QR. */
export const ScanByToken = z.object({ token: z.string().min(1), ...ScanCommon });

/** Typed in from the paper ticket or the app: order number and seat code, e.g. OC-10029 and F3. */
export const ScanByOrder = z.object({
  orderNo: z
    .string()
    .trim()
    .regex(/^OC-\d{1,12}$/i),
  seat: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{1,3}\d{1,3}$/),
  checkCode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z]{4}$/),
  ...ScanCommon,
});

export const ScanBody = z.union([ScanByToken, ScanByOrder]);
/** The wire shape (the label is optional); the parsed value has it trimmed or absent. */
export type ScanBody = z.input<typeof ScanBody>;

export const ScanResultCodeSchema = z.enum([
  'admitted',
  'repeat',
  'already_used',
  'wrong_branch',
  'wrong_day',
  'invalid',
  'undone',
]);
export type ScanResultCode = z.infer<typeof ScanResultCodeSchema>;

export const ScanResultSchema = z.object({
  scanId: z.string(),
  result: ScanResultCodeSchema,
  ticket: z
    .object({
      id: z.string(),
      seatCode: z.string(),
      hallName: z.string(),
      movieTitle: z.string(),
      posterUrl: z.string(),
      tone: z.string(),
      startsAt: z.string(),
      partyIndex: z.number().int(),
      partySize: z.number().int(),
    })
    .nullable(),
  previous: z
    .object({
      at: z.string(),
      staffName: z.string(),
      deviceLabel: z.string().nullable(),
    })
    .nullable(),
  undoUntil: z.string().nullable(),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;

/** One showtime of the current business day with door progress (`GET /v1/staff/today`). */
export const TodayShowtimeSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  hallName: z.string(),
  branchId: z.string(),
  branchName: z.string(),
  movieTitle: z.string(),
  posterUrl: z.string(),
  tone: z.string(),
  admitted: z.number().int(),
  sold: z.number().int(),
  capacity: z.number().int(),
});
export type TodayShowtime = z.infer<typeof TodayShowtimeSchema>;

/** Query of `GET /v1/admin/scans`. */
export const AdminScanQuery = z.object({
  branchId: z.string().uuid().optional(),
  /** Business date (YYYY-MM-DD, Ulaanbaatar, day runs 05:00 to 05:00). */
  date: UbDate.optional(),
  showtimeId: z.string().uuid().optional(),
  result: ScanResultCodeSchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminScanQuery = z.infer<typeof AdminScanQuery>;

/** One row of the admin scan history. */
export const AdminScanSchema = z.object({
  id: z.string(),
  at: z.string(),
  result: ScanResultCodeSchema,
  /** An admit that was taken back afterwards. */
  undone: z.boolean(),
  staffName: z.string(),
  deviceLabel: z.string().nullable(),
  /** Null for a scan that matched no ticket. */
  ticket: z
    .object({
      seatCode: z.string(),
      orderNo: z.string(),
      hallName: z.string(),
      movieTitle: z.string(),
      showtimeId: z.string(),
      startsAt: z.string(),
    })
    .nullable(),
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
});
export type AdminScan = z.infer<typeof AdminScanSchema>;

export const AdminScanPageSchema = z.object({
  items: z.array(AdminScanSchema),
  nextCursor: z.string().nullable(),
});
export type AdminScanPage = z.infer<typeof AdminScanPageSchema>;
