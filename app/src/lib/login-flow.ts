import { type Hold, HoldSchema, type OtpChannel } from '@/shared';
import { ApiError, api } from './api';
import { getAccessToken, getRefreshToken, getUser, loginWithOtp } from './auth';
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
): Promise<{ lostSeatIds: string[]; heldCount: number }> {
  let guest: { token: string; refresh: string | null; holds: Hold[] } | null = null;

  if (getUser()?.role === 'guest') {
    let holds: Hold[] = [];
    if (showtimeId) {
      // Let a failure here stop the login before anything changes, so the customer can retry
      // with the same code: swallowing it would drop the seats without a word.
      // api() refreshes an expired access token first, so the tokens read afterwards are fresh.
      holds = HoldSchema.array().parse(await api(`/showtimes/${showtimeId}/holds/mine`));
    }
    const token = getAccessToken();
    if (token) guest = { token, refresh: getRefreshToken(), holds };
  }

  // A wrong code throws here and nothing has changed yet.
  await loginWithOtp(channel, target, code);
  if (!guest) return { lostSeatIds: [], heldCount: 0 };
  const { token, refresh, holds } = guest;

  let lostSeatIds: string[] = [];
  if (showtimeId && holds.length > 0) {
    await releaseAsGuest(holds, token);
    lostSeatIds = await reholdSeats(
      showtimeId,
      holds.map((h) => h.seatId),
    );
    // The new account's hold list was first read mid-swap: read it again now that it is settled.
    await queryClient.invalidateQueries({ queryKey: ['holds', showtimeId] });
  }

  // The guest session has done its job; end it on the server (best effort).
  if (refresh) {
    rawRequest<void>('/auth/logout', { method: 'POST', json: { refreshToken: refresh } }).catch(
      () => {},
    );
  }
  return { lostSeatIds, heldCount: holds.length - lostSeatIds.length };
}

/** Free the guest's holds with the guest's token; each failure is retried once. A hold that is already gone counts as freed. */
async function releaseAsGuest(holds: Hold[], token: string): Promise<void> {
  const release = (h: Hold) =>
    rawRequest<void>(`/holds/${h.id}`, { method: 'DELETE', bearer: token }).catch((e) => {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    });
  const first = await Promise.allSettled(holds.map(release));
  const failed = holds.filter((_, i) => first[i]?.status === 'rejected');
  // Whatever still fails stays held by the guest, so the re-hold reports it as lost.
  await Promise.allSettled(failed.map(release));
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
