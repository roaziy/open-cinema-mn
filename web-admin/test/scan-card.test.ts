import { type ScanResult, ScanResultCodeSchema } from '@open-cinema/shared';
import { describe, expect, it } from 'vitest';
import { canUndo, cardFor, undoSecondsLeft, VIBRATION } from '../lib/scan/card';

const base: ScanResult = {
  scanId: 's',
  result: 'admitted',
  ticket: null,
  previous: null,
  undoUntil: null,
};

describe('cardFor', () => {
  it('colour is meaning: green admit, grey repeat/undone, red every reject', () => {
    const tone = (r: ScanResult['result']) => cardFor({ ...base, result: r }).tone;
    expect(tone('admitted')).toBe('admit');
    expect(tone('repeat')).toBe('neutral');
    expect(tone('undone')).toBe('neutral');
    for (const r of ['already_used', 'wrong_branch', 'wrong_day', 'invalid'] as const) {
      expect(tone(r)).toBe('reject');
    }
  });

  it('covers every result code the API can send, with a Mongolian title', () => {
    for (const code of ScanResultCodeSchema.options) {
      expect(cardFor({ ...base, result: code }).title).toMatch(/[А-Яа-яӨөҮү]/);
    }
  });

  it('only an admit is green', () => {
    const greens = ScanResultCodeSchema.options.filter(
      (c) => cardFor({ ...base, result: c }).tone === 'admit',
    );
    expect(greens).toEqual(['admitted']);
  });

  it('plays a different sound and vibration for admit and reject', () => {
    expect(cardFor({ ...base, result: 'admitted' }).sound).toBe('admit');
    expect(cardFor({ ...base, result: 'already_used' }).sound).toBe('reject');
    expect(cardFor({ ...base, result: 'repeat' }).sound).toBe('repeat');
    expect(VIBRATION.admit).not.toEqual(VIBRATION.reject);
  });

  it('names who and when on an already-used ticket', () => {
    const c = cardFor({
      ...base,
      result: 'already_used',
      previous: { at: '2026-11-09T11:12:00Z', staffName: 'Сарнай', deviceLabel: 'Хаалга 2' },
    });
    expect(c.detail).toContain('Сарнай');
    expect(c.detail).toContain('19:12');
    expect(c.detail).toContain('Хаалга 2');
  });
});

describe('undo window', () => {
  const now = Date.parse('2026-11-09T11:00:00Z');
  it('is offered only on an admit that still has time', () => {
    const r = { ...base, undoUntil: '2026-11-09T11:01:30Z' };
    expect(canUndo(r, now)).toBe(true);
    expect(undoSecondsLeft(r, now)).toBe(90);
    expect(canUndo(r, now + 91_000)).toBe(false);
    expect(canUndo({ ...r, result: 'repeat' }, now)).toBe(false);
    expect(canUndo({ ...r, undoUntil: null }, now)).toBe(false);
  });
});
