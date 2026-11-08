import { z } from 'zod';

const ScanCommon = {
  scanId: z.string().uuid(),
  deviceId: z.string().uuid(),
  /** The door this phone was named after ("Хаалга 2"); shown to the next door that sees a repeat. */
  deviceLabel: z
    .string()
    .trim()
    .max(40)
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
