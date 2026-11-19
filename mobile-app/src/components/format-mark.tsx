import { StyleSheet, Text, View } from 'react-native';
import type { Mark } from '@/lib/format-marks';
import { colors } from '@/theme/tokens';
import { fonts } from '@/theme/type';

/**
 * A screening format as a small monochrome mark, each with its own build so the eye tells them
 * apart at a glance: IMAX a solid plate, Dolby a split plate, 3D an outline, VIP a filled tag,
 * 2D a quiet outline. Drawn in type, not the trademark artwork.
 */
export function FormatMark({ mark }: { mark: Mark }) {
  if (mark.startsWith('DOLBY')) {
    const second = mark.slice(6);
    return (
      <View style={[styles.plate, styles.split]} accessibilityLabel={mark}>
        <View style={[styles.half, styles.solid]}>
          <Text style={[styles.text, styles.onSolid]}>DOLBY</Text>
        </View>
        {second ? (
          <View style={styles.half}>
            <Text style={styles.text}>{second}</Text>
          </View>
        ) : null}
      </View>
    );
  }
  const plate =
    mark === 'IMAX'
      ? styles.solid
      : mark === 'VIP'
        ? styles.filled
        : mark === '3D'
          ? styles.outline
          : styles.quiet;
  const ink = mark === 'IMAX' ? styles.onSolid : mark === '2D' ? styles.quietText : null;
  return (
    <View style={[styles.plate, plate]} accessibilityLabel={mark}>
      <Text style={[styles.text, ink]}>{mark}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 5,
    borderCurve: 'continuous',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  text: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.2,
    color: colors.ink,
  },
  solid: { backgroundColor: colors.ink },
  onSolid: { color: colors.canvas },
  filled: { backgroundColor: colors.fill },
  outline: { borderWidth: 1, borderColor: colors.ink },
  quiet: { borderWidth: 1, borderColor: colors.chipBorder },
  quietText: { color: colors.muted },
  split: {
    flexDirection: 'row',
    paddingHorizontal: 0,
    borderWidth: 1,
    borderColor: colors.ink,
  },
  half: { paddingHorizontal: 5, justifyContent: 'center' },
});
