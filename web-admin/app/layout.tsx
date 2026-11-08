import type { Metadata, Viewport } from 'next';
import { Onest } from 'next/font/google';
import type { ReactNode } from 'react';
import { APP_NAME } from '@/lib/env';
import { gilroyCss } from '@/lib/fonts';
import './globals.css';

const onest = Onest({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-onest',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: `${APP_NAME} · Удирдлага`, template: `%s · ${APP_NAME}` },
  description: 'Кино театрын удирдлага ба билет шалгалт',
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'black-translucent' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0B0B0D',
  colorScheme: 'dark',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const gilroy = gilroyCss();
  return (
    <html lang="mn" className={onest.variable}>
      <head>
        {gilroy && (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: @font-face rules built from a fixed file list in lib/fonts.ts
          <style dangerouslySetInnerHTML={{ __html: gilroy }} />
        )}
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
