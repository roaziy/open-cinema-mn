/** Normalize a Mongolian mobile number to "+976XXXXXXXX", or null. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let local: string;
  if (digits.length === 8) local = digits;
  else if (digits.length === 11 && digits.startsWith('976')) local = digits.slice(3);
  else return null;
  if (!/^[6-9]\d{7}$/.test(local)) return null;
  return `+976${local}`;
}

/** Trim and lowercase an email; null if it does not look like one. */
export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
