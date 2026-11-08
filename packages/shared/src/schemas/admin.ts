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
