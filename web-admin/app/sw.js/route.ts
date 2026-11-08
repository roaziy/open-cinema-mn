import { swSource } from '@/lib/sw-source';

export const dynamic = 'force-static';

export function GET() {
  return new Response(swSource(process.env.OC_BUILD_ID ?? 'dev'), {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache, no-store, must-revalidate',
      'service-worker-allowed': '/',
    },
  });
}
