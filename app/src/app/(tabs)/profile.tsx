import { UserCircle } from 'phosphor-react-native';
import { TabScreen } from '@/components/tab-screen';
import { useI18n } from '@/i18n';
import { hues } from '@/theme/tokens';

export default function ProfileScreen() {
  const { t } = useI18n();
  return (
    <TabScreen
      title={t('profile.title')}
      message={t('profile.empty')}
      tile={{ sf: 'person.crop.circle.fill', phosphor: UserCircle, hue: hues.purple }}
    />
  );
}
