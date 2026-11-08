// In-memory only: the contact email a guest typed at the gate, per showtime, for checkout.
const contactEmails = new Map<string, string>();

export function setContactEmail(showtimeId: string, email: string) {
  contactEmails.set(showtimeId, email);
}

export function getContactEmail(showtimeId: string): string | null {
  return contactEmails.get(showtimeId) ?? null;
}

export function clearContactEmail(showtimeId: string) {
  contactEmails.delete(showtimeId);
}

// One order attempt per (showtime, set of holds). Re-entering checkout with the same holds
// reuses the key, so the server replays the booking it already made instead of refusing holds
// that are already inside it.
type Attempt = { key: string; bookingId: string | null };
const attempts = new Map<string, Attempt>();

export function attemptSignature(showtimeId: string, holdIds: readonly string[]): string {
  return `${showtimeId}:${[...holdIds].sort().join(',')}`;
}

/** The attempt for these holds; created with `makeKey()` the first time. */
export function getAttempt(signature: string, makeKey: () => string): Attempt {
  let a = attempts.get(signature);
  if (!a) {
    a = { key: makeKey(), bookingId: null };
    attempts.set(signature, a);
  }
  return a;
}

export function setAttemptBooking(signature: string, bookingId: string) {
  const a = attempts.get(signature);
  if (a) a.bookingId = bookingId;
}
