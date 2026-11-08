import { sql } from 'drizzle-orm';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { db } from '../src/db/client';
import type { Messages } from '../src/messages';

/** Truncates every table in the public schema and restarts identities. */
export async function resetDb(): Promise<void> {
  const res = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  );
  const names = res.rows.map((r) => `"${r.tablename}"`);
  if (names.length === 0) return;
  await db.execute(sql.raw(`truncate table ${names.join(', ')} restart identity cascade`));
}

export type SentMessage = { channel: 'sms' | 'email'; to: string; subject?: string; body: string };

export function fakeMessages(): Messages & { sent: SentMessage[] } {
  const sent: SentMessage[] = [];
  return {
    sent,
    async sms(to, text) {
      sent.push({ channel: 'sms', to, body: text });
    },
    async email({ to, subject, text }) {
      sent.push({ channel: 'email', to, subject, body: text });
    },
  };
}

export function fixedClock(iso: string): (() => Date) & { advance(ms: number): void } {
  let now = new Date(iso).getTime();
  const clock = (() => new Date(now)) as (() => Date) & { advance(ms: number): void };
  clock.advance = (ms: number) => {
    now += ms;
  };
  return clock;
}

export function makeTestApp(over: Partial<import('../src/app').AppDeps> = {}): Express {
  return createApp({ messages: fakeMessages(), ...over });
}

/** Unwraps the first row of an insert/select, failing the test loudly when it is missing. */
export function one<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}
