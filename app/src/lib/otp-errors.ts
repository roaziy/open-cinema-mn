import type { TKey } from '@/i18n';
import { ApiError } from './api';

/** Every code the auth routes can answer with, and the message for it. */
const ERROR_KEYS: Record<string, TKey> = {
  invalid_code: 'login.err.invalid_code', // wrong, expired or already used: the server does not say which
  too_many_attempts: 'login.err.too_many_attempts',
  resend_too_soon: 'login.err.resend_too_soon',
  too_many_requests: 'login.err.too_many_requests',
  rate_limited: 'login.err.rate_limited',
  invalid_target: 'login.err.invalid_target',
  sms_failed: 'login.err.sms_failed',
  email_failed: 'login.err.email_failed',
  forbidden: 'login.err.forbidden', // staff by email, admins by code
};

export function otpErrorKey(e: unknown): TKey {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'error.network';
    return ERROR_KEYS[e.code] ?? 'login.err.generic';
  }
  return 'login.err.generic';
}
