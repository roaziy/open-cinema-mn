import { describe, expect, it } from 'vitest';
import { orderDigits, toLatinCode } from '../components/scan/ManualEntry';

describe('toLatinCode', () => {
  it('maps Cyrillic look-alikes to Latin and upper-cases', () => {
    expect(toLatinCode('АВСЕНКМОРТХУ')).toBe('ABCEHKMOPTXY');
    expect(toLatinCode('кор7')).toBe('KOP7');
  });
  it('leaves Latin letters and digits alone', () => {
    expect(toLatinCode('f3')).toBe('F3');
    expect(toLatinCode('K7Q2')).toBe('K7Q2');
  });
  it('leaves other Cyrillic letters, which no code contains, for validation to reject', () => {
    expect(toLatinCode('Ж1')).toBe('Ж1');
  });
});

describe('orderDigits', () => {
  it('keeps only the digits after an OC- prefix', () => {
    expect(orderDigits('oc-10029')).toBe('10029');
    expect(orderDigits('10029')).toBe('10029');
  });
});
