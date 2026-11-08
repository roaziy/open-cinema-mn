import { createApp } from './app';
import { env } from './env';

createApp().listen(env.PORT, () => {
  console.log(`Open Cinema API listening on :${env.PORT}`);
});
