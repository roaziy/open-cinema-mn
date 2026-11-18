import { describe, expect, it } from 'vitest';
import { generateSeats, HallGenParams } from '@/lib/shared';
import { inferGen, sameGen } from '../lib/hall-layout';
import { HALL_TEMPLATES, templateKinds } from '../lib/hall-templates';

describe('hall templates', () => {
  it('are valid layouts the editor reads back unchanged', () => {
    for (const t of HALL_TEMPLATES) {
      expect(HallGenParams.safeParse(t.gen).success).toBe(true);
      const back = inferGen(generateSeats(t.gen));
      expect(back && sameGen(back, t.gen)).toBe(true);
    }
  });

  it('paints premium back rows and wheelchair seats at the front-row ends', () => {
    const std = HALL_TEMPLATES.find((t) => t.id === 'standard');
    if (!std) throw new Error('standard template missing');
    const kinds = templateKinds(std);
    expect(kinds.get('A-1')).toBe('wheelchair');
    expect(kinds.get('A-18')).toBe('wheelchair');
    expect(kinds.get('A-2')).toBeUndefined();
    expect(kinds.get('J-5')).toBe('premium'); // 10th row
    expect(kinds.get('I-5')).toBe('premium');
    expect(kinds.get('H-5')).toBeUndefined();
  });

  it('makes every seat premium in a recliner hall', () => {
    const vip = HALL_TEMPLATES.find((t) => t.id === 'vip');
    if (!vip) throw new Error('vip template missing');
    const kinds = templateKinds(vip);
    expect(kinds.size).toBe(vip.gen.rows * vip.gen.seatsPerRow);
    expect(new Set(kinds.values())).toEqual(new Set(['premium']));
  });
});
