import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/open_cinema_test';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    // Tests share one real Postgres database; files run one after another.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB,
      TEST_DATABASE_URL: TEST_DB,
      JWT_SECRET: 'test-jwt-secret-0123456789abcdef',
      QR_SECRET: 'test-qr-secret-0123456789abcdef',
      LINK_SECRET: 'test-link-secret-0123456789abcdef',
      MESSAGES_PROVIDER: 'dev',
      STORAGE_PROVIDER: 'local',
      PAYMENT_PROVIDER: 'mock',
      CORS_ORIGINS: 'http://localhost:3000',
    },
  },
});
