import { PublicUserSchema } from '@open-cinema/shared';
import { api } from './api';
import { updateUser } from './auth';

export async function requestEmailCode(email: string): Promise<void> {
  await api<void>('/me/email', { method: 'POST', json: { email } });
}

/** Verifying stores the address on the account; the local profile is updated to match. */
export async function verifyEmailCode(code: string): Promise<void> {
  const user = PublicUserSchema.parse(
    await api('/me/email/verify', { method: 'POST', json: { code } }),
  );
  await updateUser(user);
}
