import { describe, expect, it } from 'vitest';
import { generateSeats, HALL_TEMPLATES, HallGenParams, templateKinds } from '@/lib/shared';
import { inferGen, sameGen } from '../lib/hall-layout';

const byId = (id: string) => {
  const t = HALL_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`${id} template missing`);
  return t;
};

describe('hall templates', () => {
  it('are valid layouts the editor reads back unchanged, with unique names', () => {
    for (const t of HALL_TEMPLATES) {
      expect(HallGenParams.safeParse(t.gen).success).toBe(true);
      const back = inferGen(generateSeats(t.gen));
      expect(back && sameGen(back, t.gen)).toBe(true);
    }
    expect(new Set(HALL_TEMPLATES.map((t) => t.name)).size).toBe(HALL_TEMPLATES.length);
  });

  it('paints premium back rows and wheelchair seats at the front-row ends', () => {
    const kinds = templateKinds(byId('2d'));
    expect(kinds.get('A-1')).toBe('wheelchair');
    expect(kinds.get('A-18')).toBe('wheelchair');
    expect(kinds.get('A-2')).toBeUndefined();
    expect(kinds.get('J-5')).toBe('premium'); // 10th row
    expect(kinds.get('I-5')).toBe('premium');
    expect(kinds.get('H-5')).toBeUndefined();
  });

  it('makes every seat premium in a recliner hall', () => {
    const vip = byId('vip');
    const kinds = templateKinds(vip);
    expect(kinds.size).toBe(vip.gen.rows * vip.gen.seatsPerRow);
    expect(new Set(kinds.values())).toEqual(new Set(['premium']));
  });
});
