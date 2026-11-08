import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { BACKEND_ROOT } from '../lib/paths';
import { db, pool } from './client';

try {
  await migrate(db, { migrationsFolder: path.join(BACKEND_ROOT, 'drizzle') });
  console.log('migrations applied');
} finally {
  await pool.end();
}
