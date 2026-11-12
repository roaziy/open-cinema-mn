/**
 * The login field already shows "+976", so a number pasted or filled in by iOS AutoFill with its
 * country code ("+976 9504 9990", "0097695049990", "97695049990") keeps only the local 8 digits.
 * Anything else is left as typed (a local number may itself start with 976).
 */
export function localPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  const international = /^\s*(\+|00)/.test(input);
  if (international && digits.startsWith('00976')) return digits.slice(5);
  if (international && digits.startsWith('976')) return digits.slice(3);
  if (digits.length === 11 && digits.startsWith('976')) return digits.slice(3);
  return input;
}
