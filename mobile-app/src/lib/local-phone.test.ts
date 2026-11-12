import { describe, expect, it } from 'vitest';
import { localPhone } from './local-phone';

describe('localPhone', () => {
  it('drops a country code added by AutoFill or a paste', () => {
    expect(localPhone('+976 95 049990')).toBe('95049990');
    expect(localPhone('+97695049990')).toBe('95049990');
    expect(localPhone('0097695049990')).toBe('95049990');
    expect(localPhone('976 9504 9990')).toBe('95049990');
  });

  it('leaves local input alone, including numbers that start with 976', () => {
    expect(localPhone('9765')).toBe('9765');
    expect(localPhone('97654321')).toBe('97654321');
    expect(localPhone('9504 9990')).toBe('9504 9990');
    expect(localPhone('')).toBe('');
  });
});
