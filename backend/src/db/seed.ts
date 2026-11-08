import { env } from '../env';
import { createStorage } from '../storage';
import { db, pool } from './client';
import { runSeed } from './run-seed';

try {
  const summary = await runSeed({
    db,
    storage: createStorage(),
    now: new Date(),
    nodeEnv: env.NODE_ENV,
    adminEmail: env.SEED_ADMIN_EMAIL,
    adminPassword: env.SEED_ADMIN_PASSWORD,
  });
  console.log('seeded', summary);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
