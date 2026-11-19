import type { ShowtimeFormat } from '@/shared';

export type Mark = 'IMAX' | '3D' | '2D' | 'DOLBY VISION' | 'DOLBY ATMOS' | 'DOLBY' | 'VIP';

const WORDS = /\b(imax|3d|2d|dolby\s+vision|dolby\s+atmos|dolby|vip)\b/gi;

/**
 * The format marks a showing wears and whatever of its hall name they leave unsaid.
 * ponytail: read from the hall's name ("3D Dolby Vision", "VIP"); a hall `kind` from the API
 * would replace the keyword match once halls carry one.
 */
export function formatMarks(
  format: ShowtimeFormat,
  hallName: string,
): { marks: Mark[]; hall: string | null } {
  const name = hallName.toLowerCase();
  const marks: Mark[] = [format === 'IMAX' || name.includes('imax') ? 'IMAX' : format];
  if (/dolby\s+vision/.test(name)) marks.push('DOLBY VISION');
  else if (/dolby\s+atmos/.test(name)) marks.push('DOLBY ATMOS');
  else if (name.includes('dolby')) marks.push('DOLBY');
  if (/\bvip\b/.test(name)) marks.push('VIP');
  const rest = hallName.replace(WORDS, '').replace(/\s+/g, ' ').trim();
  // "3D танхим" says nothing past its mark; "Жижиг танхим" and "Танхим 1" do.
  return { marks, hall: rest === '' || rest.toLowerCase() === 'танхим' ? null : rest };
}
