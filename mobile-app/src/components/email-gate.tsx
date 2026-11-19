import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { updateUser, useAuth } from '@/lib/auth';
import { needsEmail } from '@/lib/member';
import { useMe } from '@/lib/queries';

/**
 * Renders nothing. A signed-in customer without a verified email is sent to the full-screen
 * `/email-required` modal, on sign-in and on app start. It waits while the login modal is still
 * on screen so that modal's own dismiss never closes it.
 */
export function EmailGate() {
  const router = useRouter();
  const pathname = usePathname();
  const navReady = !!useRootNavigationState()?.key;
  const { ready, user } = useAuth();
  const customer = ready && user?.role === 'customer';
  const missing = needsEmail(user);

  // The stored profile can be older than the server's: re-read it once per sign-in.
  const me = useMe(customer);
  useEffect(() => {
    if (!me.data || !user || me.data.id !== user.id) return;
    if (JSON.stringify(me.data) !== JSON.stringify(user)) void updateUser(me.data);
  }, [me.data, user]);

  useEffect(() => {
    if (!navReady || !missing) return;
    if (pathname === '/login' || pathname === '/email-required') return;
    router.push('/email-required');
  }, [navReady, missing, pathname, router]);

  return null;
}
