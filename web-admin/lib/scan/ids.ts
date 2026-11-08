/** A random v4 UUID; `crypto.randomUUID` only exists in secure contexts, so fall back for http. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const KEY = 'oc.deviceId';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let memory: string | null = null;

/** The id this phone keeps in localStorage, made once. Private mode falls back to memory. */
export function deviceId(storage?: Pick<Storage, 'getItem' | 'setItem'>): string {
  try {
    const s = storage ?? localStorage;
    const found = s.getItem(KEY);
    if (found && UUID.test(found)) return found;
    const fresh = newId();
    s.setItem(KEY, fresh);
    return fresh;
  } catch {
    memory ??= newId();
    return memory;
  }
}
