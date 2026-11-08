import { createApp, createDeps } from './app';
import { env } from './env';
import { startSweeper } from './jobs/sweeper';

if (env.NODE_ENV === 'production' && env.TRUST_PROXY === 0) {
  console.warn(
    'TRUST_PROXY is 0: behind a reverse proxy every client shares its address. Set TRUST_PROXY=1 for one proxy hop.',
  );
}

const deps = createDeps();
createApp(deps).listen(env.PORT, () => {
  console.log(`Open Cinema API listening on :${env.PORT}`);
});
startSweeper(deps);
