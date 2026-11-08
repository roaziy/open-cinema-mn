import { FilmSlate } from 'phosphor-react-native';
import { TabScreen } from '@/components/tab-screen';
import { useI18n } from '@/i18n';
import { hues } from '@/theme/tokens';

export default function MoviesScreen() {
  const { t } = useI18n();
  return (
    <TabScreen
      title={t('movies.title')}
      message={t('movies.empty')}
      tile={{ sf: 'film.fill', phosphor: FilmSlate, hue: hues.indigo }}
    />
  );
}
