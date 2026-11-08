import { Ticket } from 'phosphor-react-native';
import { TabScreen } from '@/components/tab-screen';
import { useI18n } from '@/i18n';
import { hues } from '@/theme/tokens';

export default function TicketsScreen() {
  const { t } = useI18n();
  return (
    <TabScreen
      title={t('tickets.title')}
      message={t('tickets.empty')}
      tile={{ sf: 'ticket.fill', phosphor: Ticket, hue: hues.teal }}
    />
  );
}
