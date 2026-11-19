// Fills the coming days with showings of the films now showing, in every hall (or one branch's).
// Days a hall already has showings are left as they are, so it is safe to re-run any time.
//   showtimes:week [-- --branch "<branch name or id>"] [--days 7] [--from YYYY-MM-DD]
import { parseArgs } from 'node:util';
import { db, pool } from '../db/client';
import { branches } from '../db/schema';
import { scheduleWeek } from '../services/week-schedule';
import { ubDate } from '../shared';

const USAGE =
  'usage: showtimes:week -- [--branch "<branch name or id>"] [--days 7] [--from YYYY-MM-DD]';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      branch: { type: 'string' },
      days: { type: 'string' },
      from: { type: 'string' },
    },
  });
  const days = values.days === undefined ? 7 : Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 31) {
    throw new Error(`--days must be 1-31. ${USAGE}`);
  }
  if (values.from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.from)) {
    throw new Error(`--from must be YYYY-MM-DD. ${USAGE}`);
  }

  let branchIds: string[] | undefined;
  let label = 'all branches';
  if (values.branch) {
    const all = await db.select({ id: branches.id, name: branches.name }).from(branches);
    const wanted = values.branch.trim().toLowerCase();
    const b = all.find((x) => x.id === values.branch || x.name.toLowerCase() === wanted);
    if (!b) {
      throw new Error(
        `no branch "${values.branch}". ${USAGE}\nbranches: ${all.map((x) => x.name).join(', ') || '(none)'}`,
      );
    }
    branchIds = [b.id];
    label = b.name;
  }

  const now = new Date();
  const from = values.from ?? ubDate(now);
  const r = await scheduleWeek(db, { now, from, days, branchIds });
  console.log(`${label}, ${days} days from ${from}:`);
  console.log(
    `  created ${r.created} showings, kept ${r.keptDays} hall-days that already had showings, skipped ${r.skippedSlots} slots (past or busy)`,
  );
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
