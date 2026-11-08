const KEY = 'oc.doorLabel';
export const MAX_LABEL = 40;

/** Trimmed, collapsed whitespace, at most 40 characters; empty means "not named". */
export function cleanLabel(v: string): string {
  // Control and invisible formatting characters (NUL, bidi overrides) never reach a door card.
  return v
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL)
    .trim();
}

export function readDoorLabel(storage?: Pick<Storage, 'getItem'>): string {
  try {
    return cleanLabel((storage ?? localStorage).getItem(KEY) ?? '');
  } catch {
    return '';
  }
}

export function saveDoorLabel(v: string, storage?: Pick<Storage, 'setItem'>): string {
  const clean = cleanLabel(v);
  try {
    (storage ?? localStorage).setItem(KEY, clean);
  } catch {
    // Private mode: the name lasts until the page closes.
  }
  return clean;
}
