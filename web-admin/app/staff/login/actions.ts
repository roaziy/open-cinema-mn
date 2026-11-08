'use server';

import { normalizePhone, OtpVerifyBody } from '@open-cinema/shared';
import { cookies } from 'next/headers';
import { RedirectType, redirect } from 'next/navigation';
import { readClaims } from '@/lib/auth/claims';
import { setAuthCookies } from '@/lib/auth/cookies';
import { safeNext } from '@/lib/auth/redirects';
import { postForTokens, postJson } from '@/lib/auth/server';

/** `retryAfterSec` is a duration, so the browser's clock never matters. */
export type RequestState = { error?: string; phone?: string; ok?: true; retryAfterSec?: number };
export type VerifyState = { error?: string };

/** The API allows a new code 60 s after the last one. */
const RESEND_AFTER_S = 60;

const REQUEST_ERRORS: Record<string, string> = {
  invalid_target: 'Утасны дугаараа шалгана уу.',
  resend_too_soon: 'Шинэ код авахаас өмнө түр хүлээнэ үү.',
  too_many_requests: 'Хэт олон код хүссэн байна. Нэг цагийн дараа дахин оролдоно уу.',
  rate_limited: 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.',
  sms_failed: 'Код илгээж чадсангүй. Дахин оролдоно уу.',
  unreachable: 'Серверт холбогдож чадсангүй. Дахин оролдоно уу.',
};

const VERIFY_ERRORS: Record<string, string> = {
  invalid_code: 'Код буруу эсвэл хугацаа нь дууссан байна.',
  too_many_attempts: 'Хэт олон буруу оролдлого. Шинэ код авна уу.',
  rate_limited: 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.',
  forbidden: 'Энэ дугаараар ажилтны эрх олгогдоогүй байна.',
  unreachable: 'Серверт холбогдож чадсангүй. Дахин оролдоно уу.',
};

export async function requestOtp(_prev: RequestState, form: FormData): Promise<RequestState> {
  const phone = normalizePhone(String(form.get('phone') ?? ''));
  if (!phone) return { error: REQUEST_ERRORS.invalid_target };

  const out = await postJson('/auth/otp/request', { channel: 'sms', target: phone });
  if (!out.ok) {
    return { phone, error: REQUEST_ERRORS[out.code] ?? 'Код илгээж чадсангүй. Дахин оролдоно уу.' };
  }
  return { ok: true, phone, retryAfterSec: RESEND_AFTER_S };
}

export async function verifyOtp(_prev: VerifyState, form: FormData): Promise<VerifyState> {
  const parsed = OtpVerifyBody.safeParse({
    channel: 'sms',
    target: String(form.get('phone') ?? ''),
    code: String(form.get('code') ?? ''),
  });
  if (!parsed.success) return { error: VERIFY_ERRORS.invalid_code };

  const out = await postForTokens('/auth/otp/verify', parsed.data);
  if (!out.ok) return { error: VERIFY_ERRORS[out.code] ?? 'Нэвтэрч чадсангүй. Дахин оролдоно уу.' };

  const { accessToken, refreshToken, user } = out.data;
  if (user.role !== 'staff') {
    // The API creates a customer for an unknown number. Staff accounts are made by an admin.
    await postJson('/auth/logout', { refreshToken });
    return { error: 'Энэ дугаар ажилтнаар бүртгэгдээгүй байна. Админтай холбогдоно уу.' };
  }
  setAuthCookies(await cookies(), { accessToken, refreshToken }, readClaims(accessToken)?.exp);
  redirect(safeNext(form.get('next'), '/staff'), RedirectType.replace);
}
