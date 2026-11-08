// Creates an admin account in any environment (including NODE_ENV=production). Never truncates.
//   admin:create -- --email you@example.com [--name "Your Name"] [--reset-password]
// The password comes from ADMIN_PASSWORD, or is typed at a hidden prompt.
import { parseArgs } from 'node:util';
import { db, pool } from '../db/client';
import { AdminAccountError, createAdmin } from '../services/admin-account';

/** Reads one line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) {
    return Promise.reject(new Error('set ADMIN_PASSWORD, or run this in an interactive terminal'));
  }
  return new Promise((resolve, reject) => {
    stderr.write(question);
    let value = '';
    const done = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stderr.write('\n');
      fn();
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done(() => resolve(value));
        if (ch === '\u0003') return done(() => reject(new Error('cancelled')));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'reset-password': { type: 'boolean', default: false },
    },
  });
  if (!values.email)
    throw new Error('usage: admin:create -- --email <email> [--name <name>] [--reset-password]');
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden('Password: ');
    const again = await promptHidden('Repeat password: ');
    if (again !== password) throw new Error('the passwords do not match');
  }
  const result = await createAdmin(db, {
    email: values.email,
    name: values.name,
    password,
    resetPassword: values['reset-password'],
    now: new Date(),
  });
  console.log(result === 'created' ? 'admin created' : 'admin password reset');
}

try {
  await main();
} catch (err) {
  console.error(err instanceof AdminAccountError || err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
