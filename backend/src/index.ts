import { createApp, createDeps } from './app';
import { env } from './env';
import { startSweeper } from './jobs/sweeper';

const deps = createDeps();
createApp(deps).listen(env.PORT, () => {
  console.log(`Open Cinema API listening on :${env.PORT}`);
});
startSweeper(deps);
