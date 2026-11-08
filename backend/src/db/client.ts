import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env';
import * as schema from './schema';
import { dbSsl, stripSslMode } from './ssl';

export const pool = new pg.Pool({
  connectionString: stripSslMode(env.DATABASE_URL),
  ssl: dbSsl(env),
  connectionTimeoutMillis: 10_000,
});
export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };
