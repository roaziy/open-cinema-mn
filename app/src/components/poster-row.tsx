import type { MovieSummary } from '@open-cinema/shared';
import { router } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { Poster } from './poster';
import { Pressable } from './pressable';

const CARD_WIDTH = 132;

type Props = {
  title: string;
  movies: MovieSummary[];
  /** Second caption line under the title. */
  caption: (m: MovieSummary) => string;
};

export function PosterRow({ title, movies, caption }: Props) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">
        {title}
      </Text>
      <FlatList
        data={movies}
        keyExtractor={(m) => m.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/movie/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={item.title}
          >
            <Poster uri={item.posterUrl} width={CARD_WIDTH} />
            <Text style={styles.name} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.caption} numberOfLines={1}>
              {caption(item)}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

export function PosterRowSkeleton({ children }: { children: React.ReactNode }) {
  return <View style={styles.list}>{children}</View>;
}

const styles = StyleSheet.create({
  section: { gap: space.md, marginTop: space.xxl },
  heading: { ...type.title, color: colors.ink, paddingHorizontal: space.lg },
  list: { paddingHorizontal: space.lg, gap: space.md, flexDirection: 'row' },
  card: { width: CARD_WIDTH, gap: space.xs },
  name: { ...type.bodyMedium, color: colors.ink, marginTop: space.sm },
  caption: { ...type.caption, color: colors.muted },
});
