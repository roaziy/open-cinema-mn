import { describe, expect, it } from 'vitest';
import { chooseFonts } from './font-select';

const all = ['./GIP-Regular.otf', './GIP-Medium.otf', './GIP-SemiBold.otf'];

describe('chooseFonts', () => {
  it('uses Gilroy when all three private files exist', () => {
    expect(chooseFonts(all)).toEqual({
      family: 'GIP',
      files: {
        'GIP-Regular': './GIP-Regular.otf',
        'GIP-Medium': './GIP-Medium.otf',
        'GIP-SemiBold': './GIP-SemiBold.otf',
      },
    });
  });
  it('falls back to Onest with no files', () => {
    expect(chooseFonts([])).toEqual({ family: 'Onest', files: null });
  });
  it('falls back to Onest when a weight is missing', () => {
    expect(chooseFonts(all.slice(0, 2)).family).toBe('Onest');
  });
  it('ignores unrelated files', () => {
    expect(chooseFonts(['./Other-Regular.otf', ...all.slice(1)]).family).toBe('Onest');
  });
});
