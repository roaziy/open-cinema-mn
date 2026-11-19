import { z } from 'zod';

export const LoyaltyEntrySchema = z.object({
  id: z.string(),
  /** Signed: positive when earned, negative when a refund took it back. */
  points: z.number().int(),
  kind: z.enum(['earn', 'reverse']),
  createdAt: z.string(),
  movieTitle: z.string().nullable(),
  bookingId: z.string().nullable(),
});
export type LoyaltyEntry = z.infer<typeof LoyaltyEntrySchema>;

export const MyPointsSchema = z.object({
  /** Never below 0. */
  balance: z.number().int().nonnegative(),
  memberNo: z.number().int(),
  /** Newest first, at most 50. */
  entries: z.array(LoyaltyEntrySchema),
});
/** Same schema under the contract name (value and type share it). */
export const MyPoints = MyPointsSchema;
export type MyPoints = z.infer<typeof MyPointsSchema>;
