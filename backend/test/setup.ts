import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/open_cinema_test';

async function ensureDatabase(target: string) {
  const u = new URL(target);
  const name = decodeURIComponent(u.pathname.slice(1));
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`unsafe test database name: ${name}`);
  if (!name.includes('test')) throw new Error(`refusing to use non-test database: ${name}`);
  u.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  try {
    const found = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (found.rowCount === 0) await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
}

export async function setup() {
  await ensureDatabase(url);
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  } finally {
    await pool.end();
  }
}
