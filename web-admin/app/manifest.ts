import type { MetadataRoute } from 'next';
import { APP_NAME } from '@/lib/env';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} · Удирдлага`,
    short_name: APP_NAME,
    description: 'Кино театрын удирдлага ба билет шалгалт',
    lang: 'mn',
    start_url: '/staff',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B0B0D',
    theme_color: '#0B0B0D',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
