// Creates ready-made halls (2D, 3D, 3D Dolby Vision, IMAX, VIP, small) in a branch, seats painted.
// Safe in any environment and safe to re-run: a hall whose name already exists is skipped.
//   halls:create -- --list
//   halls:create -- --branch "<branch name or id>" [--only imax,vip]
import { parseArgs } from 'node:util';
import { db, pool } from '../db/client';
import { branches } from '../db/schema';
import { createTemplateHalls } from '../services/halls';
import { HALL_TEMPLATES } from '../shared';

const USAGE =
  'usage: halls:create -- --branch "<branch name or id>" [--only 2d,3d,dolby,imax,vip,small] | --list';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      branch: { type: 'string' },
      only: { type: 'string' },
      list: { type: 'boolean', default: false },
    },
  });

  const all = await db.select({ id: branches.id, name: branches.name }).from(branches);
  if (values.list) {
    console.log('templates:');
    for (const t of HALL_TEMPLATES)
      console.log(`  ${t.id.padEnd(6)} ${t.name} (${t.gen.rows}×${t.gen.seatsPerRow} seats)`);
    console.log('branches:');
    for (const b of all) console.log(`  ${b.name}  ${b.id}`);
    return;
  }

  const wanted = values.branch?.trim().toLowerCase();
  const branch = wanted
    ? all.find((b) => b.id === values.branch || b.name.toLowerCase() === wanted)
    : all.length === 1
      ? all[0]
      : undefined;
  if (!branch) {
    throw new Error(
      `${values.branch ? `no branch "${values.branch}"` : 'pick a branch'}. ${USAGE}\nbranches: ${all.map((b) => b.name).join(', ') || '(none, create one in the admin first)'}`,
    );
  }

  const ids = values.only
    ?.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unknown = ids?.filter((id) => !HALL_TEMPLATES.some((t) => t.id === id)) ?? [];
  if (unknown.length) throw new Error(`unknown template: ${unknown.join(', ')}. ${USAGE}`);
  const templates = ids ? HALL_TEMPLATES.filter((t) => ids.includes(t.id)) : HALL_TEMPLATES;

  const results = await createTemplateHalls(db, branch.id, templates);
  console.log(`branch: ${branch.name}`);
  for (const r of results)
    console.log(`  ${r.created ? 'created' : 'exists '}  ${r.name} (${r.seats} seats)`);
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
