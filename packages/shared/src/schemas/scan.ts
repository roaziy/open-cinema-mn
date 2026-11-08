import { z } from 'zod';

export const ScanBody = z.object({
  token: z.string().min(1),
  scanId: z.string().uuid(),
  deviceId: z.string().uuid(),
});
export type ScanBody = z.infer<typeof ScanBody>;

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
