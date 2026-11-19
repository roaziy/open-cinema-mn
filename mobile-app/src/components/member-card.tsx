import { ChevronRight } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useI18n } from '@/i18n';
import { formatMemberNo, formatPoints } from '@/lib/member';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { Pressable } from './pressable';

type Props = {
  name: string;
  phone: string | null;
  memberNo: number | null;
  points: number | null;
  onPress: () => void;
};

/** The signed-in customer's card: who they are, member number, bonus points. Opens the history. */
export function MemberCard({ name, phone, memberNo, points, onPress }: Props) {
  const { t } = useI18n();
  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('points.title')}
    >
      <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="member" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#2E6BF0" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#0E1A3A" stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#member)" />
      </Svg>
      <View style={styles.top}>
        <View style={styles.who}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {phone ? <Text style={styles.phone}>{phone}</Text> : null}
        </View>
        <ChevronRight size={20} color={colors.onActionMuted} strokeWidth={1.75} />
      </View>
      <View style={styles.bottom}>
        <View>
          <Text style={styles.label}>{t('points.memberNo')}</Text>
          <Text style={styles.memberNo}>{memberNo === null ? '—' : formatMemberNo(memberNo)}</Text>
        </View>
        <View style={styles.pointsBlock}>
          <Text style={styles.points}>{points === null ? '—' : formatPoints(points)}</Text>
          <Text style={styles.label}>{t('points.unit')}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    padding: space.xl,
    gap: space.xxl,
    borderRadius: radius.panel,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.scrimBorder,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  who: { flex: 1, gap: 2 },
  name: { ...type.title, color: colors.ink },
  phone: { ...type.caption, color: colors.onActionMuted },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  label: { ...type.footnote, color: colors.onActionMuted },
  memberNo: { ...type.number, color: colors.ink, marginTop: 2 },
  pointsBlock: { alignItems: 'flex-end' },
  points: { ...type.largeTitle, color: colors.ink, fontVariant: ['tabular-nums'] },
});
