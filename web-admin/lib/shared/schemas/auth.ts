import { z } from 'zod';

export const RoleSchema = z.enum(['guest', 'customer', 'staff', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const PublicUserSchema = z.object({
  id: z.string(),
  role: RoleSchema,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  name: z.string().nullable(),
  branchId: z.string().nullable(),
  /** Member number of an app account; null for back-office accounts. */
  memberNo: z.number().int().nullable(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: PublicUserSchema,
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

export const OtpChannelSchema = z.enum(['sms', 'email']);
export type OtpChannel = z.infer<typeof OtpChannelSchema>;

/** `as: 'staff'` is the staff sign-in: only an existing staff account gets a code. */
const OtpAs = z.literal('staff').optional();

export const OtpRequestBody = z.object({
  channel: OtpChannelSchema,
  target: z.string().min(1).max(254),
  as: OtpAs,
});
export type OtpRequestBody = z.infer<typeof OtpRequestBody>;

export const OtpVerifyBody = z.object({
  channel: OtpChannelSchema,
  target: z.string().min(1).max(254),
  code: z.string().regex(/^\d{6}$/),
  as: OtpAs,
});
export type OtpVerifyBody = z.infer<typeof OtpVerifyBody>;

export const RefreshBody = z.object({ refreshToken: z.string().min(1) });
export type RefreshBody = z.infer<typeof RefreshBody>;

export const AdminLoginBody = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(200),
});
export type AdminLoginBody = z.infer<typeof AdminLoginBody>;

/** Minimum length of an admin password, enforced when it is set or changed. */
export const ADMIN_PASSWORD_MIN = 8;
export const AdminPasswordBody = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(ADMIN_PASSWORD_MIN).max(200),
});
export type AdminPasswordBody = z.infer<typeof AdminPasswordBody>;
