import { router } from 'expo-router';
import { Building2, Check, type LucideIcon, MapPin } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/state-views';
import { useI18n } from '@/i18n';
import { setBranchId, useBranchId } from '@/lib/branch';
import { useBranches } from '@/lib/catalog';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

/** Form sheet: pick the preferred branch (or all of them). */
export default function BranchesSheet() {
  const { t } = useI18n();
  const selected = useBranchId();
  const { data, isPending, isError, error, refetch } = useBranches();

  const choose = (id: string | null) => {
    setBranchId(id);
    router.back();
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title} accessibilityRole="header">
        {t('branch.title')}
      </Text>
      {isPending ? (
        <View style={styles.card}>
          <Skeleton height={52} />
          <Skeleton height={52} />
          <Skeleton height={52} />
        </View>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <View style={styles.card}>
          <Row
            icon={Building2}
            title={t('branch.all')}
            on={selected === null}
            onPress={() => choose(null)}
          />
          {data.map((b) => (
            <Row
              key={b.id}
              icon={MapPin}
              title={b.name}
              subtitle={b.address}
              on={selected === b.id}
              onPress={() => choose(b.id)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Row(props: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.row}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: props.on }}
    >
      <props.icon size={20} color={colors.muted} strokeWidth={1.75} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{props.title}</Text>
        {props.subtitle ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.on ? <Check size={18} color={colors.action} strokeWidth={2.25} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: space.lg, gap: space.lg },
  title: { ...type.title, color: colors.ink, marginTop: space.sm },
  card: {
    borderCurve: 'continuous',
    backgroundColor: colors.raised,
    borderRadius: radius.panel,
    padding: space.sm,
    gap: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.inner,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.bodyMedium, color: colors.ink },
  rowSub: { ...type.caption, color: colors.muted },
});
