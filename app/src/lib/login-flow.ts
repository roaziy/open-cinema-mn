import { type Hold, HoldSchema, type OtpChannel } from '@open-cinema/shared';
import { ApiError, api } from './api';
import { getAccessToken, getUser, loginWithOtp } from './auth';
import { rawRequest } from './http';
import { queryClient } from './queries';

/**
 * Log in without losing the seats a guest is holding (ruling R29). The guest's token is
 * kept just long enough to release its holds, then the same seats are held again under
 * the new account. Returns the seat ids that could not be re-held because someone else
 * took them in between; the caller tells the customer.
 */
export async function loginKeepingHolds(
  channel: OtpChannel,
  target: string,
  code: string,
  showtimeId?: string,
): Promise<{ lostSeatIds: string[] }> {
  let guestToken: string | null = null;
  let guestHolds: Hold[] = [];

  if (showtimeId && getUser()?.role === 'guest') {
    try {
      // api() refreshes an expired access token first, so the token read afterwards is fresh.
      guestHolds = HoldSchema.array().parse(await api(`/showtimes/${showtimeId}/holds/mine`));
      guestToken = getAccessToken();
    } catch {
      guestHolds = [];
    }
  }

  // A wrong code throws here and nothing has changed yet.
  await loginWithOtp(channel, target, code);

  if (!showtimeId || !guestToken || guestHolds.length === 0) return { lostSeatIds: [] };

  const token = guestToken;
  await Promise.allSettled(
    guestHolds.map((h) => rawRequest<void>(`/holds/${h.id}`, { method: 'DELETE', bearer: token })),
  );
  const lostSeatIds = await reholdSeats(
    showtimeId,
    guestHolds.map((h) => h.seatId),
  );
  // The new account's hold list was first read mid-swap: read it again now that it is settled.
  await queryClient.invalidateQueries({ queryKey: ['holds', showtimeId] });
  return { lostSeatIds };
}

/** Hold the seats as the current account; a 409 names the taken ones, which are dropped and the rest retried. */
async function reholdSeats(showtimeId: string, seatIds: string[]): Promise<string[]> {
  const lost: string[] = [];
  let remaining = seatIds;
  while (remaining.length > 0) {
    try {
      await api(`/showtimes/${showtimeId}/holds`, { method: 'POST', json: { seatIds: remaining } });
      return lost;
    } catch (e) {
      const taken =
        e instanceof ApiError && e.status === 409 && Array.isArray(e.body?.seatIds)
          ? (e.body.seatIds as string[]).filter((id) => remaining.includes(id))
          : [];
      if (taken.length === 0) {
        // Not a clash we can name: report everything left as lost rather than guess.
        lost.push(...remaining);
        return lost;
      }
      lost.push(...taken);
      remaining = remaining.filter((id) => !taken.includes(id));
    }
  }
  return lost;
}
