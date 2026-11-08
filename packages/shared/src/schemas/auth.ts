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

export const OtpRequestBody = z.object({
  channel: OtpChannelSchema,
  target: z.string().min(1).max(254),
});
export type OtpRequestBody = z.infer<typeof OtpRequestBody>;

export const OtpVerifyBody = z.object({
  channel: OtpChannelSchema,
  target: z.string().min(1).max(254),
  code: z.string().regex(/^\d{6}$/),
});
export type OtpVerifyBody = z.infer<typeof OtpVerifyBody>;

export const RefreshBody = z.object({ refreshToken: z.string().min(1) });
export type RefreshBody = z.infer<typeof RefreshBody>;

export const AdminLoginBody = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(200),
});
export type AdminLoginBody = z.infer<typeof AdminLoginBody>;
