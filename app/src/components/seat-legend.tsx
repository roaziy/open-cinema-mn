import { Wheelchair } from 'phosphor-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { SeatCell, type SeatStatus } from './seat-cell';

const S = 16;

function Swatch({
  status,
  kind = 'standard',
}: {
  status: SeatStatus;
  kind?: 'standard' | 'premium' | 'wheelchair';
}) {
  return (
    <View style={{ width: S, height: S }}>
      <SeatCell
        id="legend"
        left={0}
        top={0}
        size={S}
        kind={kind}
        status={status}
        label=""
        onPress={() => {}}
      />
    </View>
  );
}

/** Colour and shape key. Premium and wheelchair are shown free, the state you will see most. */
export function SeatLegend() {
  const { t } = useI18n();
  return (
    <View
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Item label={t('seats.free')}>
        <Swatch status="free" />
      </Item>
      <Item label={t('seats.mine')}>
        <Swatch status="mine" />
      </Item>
      <Item label={t('seats.taken')}>
        <Swatch status="taken" />
      </Item>
      <Item label={t('seats.premium')}>
        <Swatch status="free" kind="premium" />
      </Item>
      <Item label={t('seats.wheelchair')}>
        <View style={{ width: S, height: S, alignItems: 'center', justifyContent: 'center' }}>
          <Wheelchair size={S} color={colors.body} weight="fill" />
        </View>
      </Item>
    </View>
  );
}

function Item({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <View style={styles.item}>
      {children}
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: space.lg,
    rowGap: space.xs,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { ...type.footnote, color: colors.muted },
});
