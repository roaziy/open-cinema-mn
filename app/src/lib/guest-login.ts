import { TicketViewSchema } from '@open-cinema/shared';
import { Alert } from 'react-native';
import type { TKey } from '@/i18n';
import { api } from './api';
import { getUser } from './auth';

type T = (key: TKey) => string;

/**
 * Signing in does not merge a guest's tickets into the account (they stay on the guest session
 * and in the emailed ticket link). Before a guest who already has upcoming tickets signs in,
 * say so and let them back out. Resolves true to go on.
 */
export async function confirmGuestLogin(t: T): Promise<boolean> {
  if (getUser()?.role !== 'guest') return true;
  let count = 0;
  try {
    count = TicketViewSchema.array().parse(await api('/me/tickets?scope=upcoming')).length;
  } catch {
    // Cannot tell: do not block the sign-in on a failed lookup.
    return true;
  }
  if (count === 0) return true;
  return new Promise((resolve) => {
    Alert.alert(
      t('guestLogin.title'),
      t('guestLogin.body'),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('login.title'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
