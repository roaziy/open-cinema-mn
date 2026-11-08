import type { ScanResult, ScanResultCode } from '@open-cinema/shared';
import { clockUb } from '../format';

/** Colour is meaning: green admit, neutral repeat/offline, red reject. */
export type Tone = 'admit' | 'neutral' | 'reject';
export type SoundKind = 'admit' | 'repeat' | 'reject';

export type CardInfo = { tone: Tone; title: string; detail: string | null; sound: SoundKind };

export const VIBRATION: Record<SoundKind, number[]> = {
  admit: [70],
  repeat: [40, 50, 40],
  reject: [140, 70, 140, 70, 140],
};

const TITLES: Record<ScanResultCode, string> = {
  admitted: 'Орууллаа',
  repeat: 'Дахин уншууллаа',
  already_used: 'Ашиглагдсан билет',
  wrong_branch: 'Өөр салбарын билет',
  wrong_day: 'Өнөөдрийн билет биш',
  invalid: 'Хүчингүй билет',
  undone: 'Буцаалаа',
};

const TONES: Record<ScanResultCode, Tone> = {
  admitted: 'admit',
  repeat: 'neutral',
  undone: 'neutral',
  already_used: 'reject',
  wrong_branch: 'reject',
  wrong_day: 'reject',
  invalid: 'reject',
};

export function cardFor(r: ScanResult): CardInfo {
  const tone = TONES[r.result];
  const sound: SoundKind = tone === 'admit' ? 'admit' : tone === 'neutral' ? 'repeat' : 'reject';
  return { tone, title: TITLES[r.result], detail: detailFor(r), sound };
}

function detailFor(r: ScanResult): string | null {
  const prev = r.previous;
  switch (r.result) {
    case 'repeat':
      return prev ? `Энд ${clockUb(prev.at)}-д орсон` : 'Энэ хаалгаар саяхан орсон';
    case 'already_used':
      return prev
        ? [prev.staffName, clockUb(prev.at), prev.deviceLabel].filter(Boolean).join(' · ')
        : 'Өмнө нь ашиглагдсан';
    case 'wrong_branch':
      return 'Энэ билет энэ салбарынх биш';
    case 'wrong_day':
      return r.ticket ? `Сеанс ${clockUb(r.ticket.startsAt)}, өөр өдөр` : 'Сеанс өөр өдөр';
    case 'invalid':
      return 'QR код танигдсангүй эсвэл цуцлагдсан';
    default:
      return null;
  }
}

export function undoSecondsLeft(r: ScanResult, now: number): number {
  if (r.result !== 'admitted' || !r.undoUntil) return 0;
  return Math.max(0, Math.ceil((Date.parse(r.undoUntil) - now) / 1000));
}

export const canUndo = (r: ScanResult, now: number): boolean => undoSecondsLeft(r, now) > 0;
