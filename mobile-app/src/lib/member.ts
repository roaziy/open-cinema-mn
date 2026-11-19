import type { PublicUser } from '@/shared';

/** 100001 -> "OC 100 001". */
export function formatMemberNo(n: number): string {
  const digits = String(Math.trunc(Math.abs(n)));
  return `OC ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

/** 4500 -> "4,500". */
export function formatPoints(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** +120 / −120 (a real minus sign); zero carries no sign. */
export function signedPoints(n: number): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '−'}${formatPoints(Math.abs(n))}`;
}

/** A phone customer without a verified email must add one before booking. */
export function needsEmail(user: Pick<PublicUser, 'role' | 'emailVerified'> | null): boolean {
  return user?.role === 'customer' && !user.emailVerified;
}
