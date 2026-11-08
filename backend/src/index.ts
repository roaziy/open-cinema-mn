import { createApp, createDeps } from './app';
import { pool } from './db/client';
import { env } from './env';
import { startSweeper } from './jobs/sweeper';
import { createShutdown } from './lib/shutdown';

if (env.NODE_ENV === 'production' && env.TRUST_PROXY === 0) {
  console.warn(
    'TRUST_PROXY is 0: behind a reverse proxy every client shares its address. Set TRUST_PROXY=1 for one proxy hop.',
  );
}
if (env.NODE_ENV === 'production' && env.TRUST_PROXY > 0 && env.HOST !== '127.0.0.1') {
  console.warn(
    `TRUST_PROXY is ${env.TRUST_PROXY} but HOST is ${env.HOST}: clients that reach the port directly can forge x-forwarded-for. Bind 127.0.0.1 behind the proxy.`,
  );
}

const deps = createDeps();
const server = createApp(deps).listen(env.PORT, env.HOST, () => {
  console.log(`Open Cinema API listening on ${env.HOST}:${env.PORT}`);
});
const stopSweeper = startSweeper(deps);

// pm2 sends SIGINT then SIGKILL after kill_timeout (5 s); give up a little earlier.
const shutdown = createShutdown({
  server,
  stopSweeper,
  closePool: () => pool.end(),
  exit: (code) => process.exit(code),
  timeoutMs: 4000,
});
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
