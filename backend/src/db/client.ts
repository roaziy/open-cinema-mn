import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env';
import * as schema from './schema';
import { resolveDbSsl } from './ssl';

export const dbTls = resolveDbSsl(env);

export const pool = new pg.Pool({
  connectionString: dbTls.url,
  ssl: dbTls.ssl,
  connectionTimeoutMillis: 10_000,
});
export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };
