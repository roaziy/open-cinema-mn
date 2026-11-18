import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client';
import { branches, halls, seats } from '../src/db/schema';
import { createTemplateHalls } from '../src/services/halls';
import { HALL_TEMPLATES } from '../src/shared';
import { resetDb } from './helpers';

const branch = async () => {
  const [b] = await db
    .insert(branches)
    .values({ name: 'Central', address: 'UB', lat: 47.9, lng: 106.9 })
    .returning({ id: branches.id });
  return (b as { id: string }).id;
};

describe('createTemplateHalls', () => {
  beforeEach(resetDb);

  it('creates every template hall with its seats painted', async () => {
    const branchId = await branch();
    const result = await createTemplateHalls(db, branchId, HALL_TEMPLATES);
    expect(result.every((r) => r.created)).toBe(true);

    const imax = HALL_TEMPLATES.find((t) => t.id === 'imax');
    if (!imax) throw new Error('imax template missing');
    const [hall] = await db
      .select()
      .from(halls)
      .where(and(eq(halls.branchId, branchId), eq(halls.name, imax.name)));
    expect(hall).toMatchObject({ screenWidthM: imax.screenW, screenHeightM: imax.screenH });
    const rows = await db
      .select()
      .from(seats)
      .where(eq(seats.hallId, (hall as { id: string }).id));
    expect(rows).toHaveLength(imax.gen.rows * imax.gen.seatsPerRow);
    const count = (kind: string) => rows.filter((s) => s.kind === kind).length;
    expect(count('premium')).toBe(imax.premiumRows * imax.gen.seatsPerRow);
    expect(count('wheelchair')).toBe(imax.wheelchairPerSide * 2);
  });

  it('skips halls that already exist, so it can be run again', async () => {
    const branchId = await branch();
    const vip = HALL_TEMPLATES.filter((t) => t.id === 'vip');
    await createTemplateHalls(db, branchId, vip);
    const again = await createTemplateHalls(db, branchId, HALL_TEMPLATES);
    expect(again.find((r) => r.name === 'VIP')?.created).toBe(false);
    expect(again.filter((r) => r.created)).toHaveLength(HALL_TEMPLATES.length - 1);
    const all = await db.select({ id: halls.id }).from(halls).where(eq(halls.branchId, branchId));
    expect(all).toHaveLength(HALL_TEMPLATES.length);
  });
});
