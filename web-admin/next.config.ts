import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Local dev: share the monorepo-root .env with the other apps. Hosted builds use real env vars.
loadEnvConfig(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
];

// One id per build: names the service worker cache so a deploy never reuses an old one.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? Date.now().toString(36);

const config: NextConfig = {
  env: { OC_BUILD_ID: buildId },
  generateBuildId: () => buildId,
  transpilePackages: ['@open-cinema/shared'],
  poweredByHeader: false,
  agentRules: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // The worker must always be revalidated so updates reach installed PWAs.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default config;
