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
if (
  env.NODE_ENV === 'production' &&
  env.TRUST_PROXY > 0 &&
  !['127.0.0.1', '::1', 'localhost'].includes(env.HOST ?? '')
) {
  console.warn(
    `TRUST_PROXY is ${env.TRUST_PROXY} but HOST is ${env.HOST}: clients that reach the port directly can forge x-forwarded-for. Bind 127.0.0.1 behind the proxy.`,
  );
}

const deps = createDeps();
const app = createApp(deps);
const onListening = () => {
  console.log(`Open Cinema API listening on ${env.HOST ?? 'all interfaces'}:${env.PORT}`);
};
// No host: Node's dual-stack default (all interfaces).
const server = env.HOST
  ? app.listen(env.PORT, env.HOST, onListening)
  : app.listen(env.PORT, onListening);
const stopSweeper = startSweeper(deps);

// pm2 sends SIGINT then SIGKILL after kill_timeout (10 s, ecosystem.config.cjs). Drain for up to
// 7 s, destroy leftover connections then, and hard-exit at 9 s.
const shutdown = createShutdown({
  server,
  stopSweeper,
  endStreams: () => deps.seatHub.endStreams(),
  closePool: () => pool.end(),
  exit: (code) => process.exit(code),
  timeoutMs: 9000,
  forceCloseAfterMs: 7000,
});
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
