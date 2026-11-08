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
