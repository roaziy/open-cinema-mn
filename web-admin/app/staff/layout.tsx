import type { ReactNode } from 'react';
import { RegisterSW } from '@/components/pwa/RegisterSW';

/** Login and the signed-in staff area share this: it only adds the service worker. */
export default function StaffRoot({ children }: { children: ReactNode }) {
  return (
    <>
      <RegisterSW />
      {children}
    </>
  );
}
