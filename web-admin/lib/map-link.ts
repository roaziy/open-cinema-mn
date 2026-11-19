export type Point = { lat: number; lng: number };

const N = '(-?\\d{1,3}(?:\\.\\d+)?)';

// Most precise first: a Google place pin beats the map view it was opened in, an OSM marker
// beats the OSM view.
const PATTERNS = [
  new RegExp(`!3d${N}!4d${N}`), // Google place pin
  new RegExp(`@${N},${N}`), // Google map view
  new RegExp(`[?&](?:q|query|ll|center|destination)=${N}(?:,|%2C)\\s*${N}`, 'i'), // Google ?q=lat,lng
  new RegExp(`[?&]mlat=${N}&mlon=${N}`), // OSM marker
  new RegExp(`#map=\\d+(?:\\.\\d+)?/${N}/${N}`), // OSM view
  new RegExp(`^\\s*\\(?${N}\\s*,\\s*${N}\\)?\\s*$`), // "47.91845, 106.91772" copied from a map
];

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function isPoint(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

/**
 * Coordinates from a pasted Google Maps / OpenStreetMap link or a plain "lat, lng" pair.
 * Short share links (maps.app.goo.gl) carry no coordinates and give null.
 */
export function parseLocation(text: string): Point | null {
  for (const re of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (isPoint(lat, lng)) return { lat: round(lat), lng: round(lng) };
  }
  return null;
}

export const roundPoint = (p: Point): Point => ({ lat: round(p.lat), lng: round(p.lng) });
