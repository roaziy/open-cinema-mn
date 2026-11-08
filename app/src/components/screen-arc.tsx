import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useI18n } from '@/i18n';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';

const H = 78;

/** The screen as a curved line with the film's tone spilling down onto the seats. */
export function ScreenArc({ width, tone }: { width: number; tone: string }) {
  const { t } = useI18n();
  const id = useId();
  const sag = 14;
  const edge = 10;
  const line = `M ${edge} ${sag + 4} Q ${width / 2} ${-sag + 4} ${width - edge} ${sag + 4}`;
  const glow = `${line} L ${width - edge * 3} ${H} L ${edge * 3} ${H} Z`;
  return (
    <View style={{ width, height: H + space.sm }}>
      <Svg width={width} height={H}>
        <Defs>
          <LinearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={tone} stopOpacity={0.55} />
            <Stop offset="0.55" stopColor={tone} stopOpacity={0.12} />
            <Stop offset="1" stopColor={tone} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={glow} fill={`url(#${id}g)`} />
        <Path
          d={line}
          stroke={tone}
          strokeWidth={5}
          strokeOpacity={0.28}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d={line}
          stroke={colors.ink}
          strokeWidth={2}
          strokeOpacity={0.9}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <Text style={styles.label}>{t('seats.screen')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...type.footnote,
    position: 'absolute',
    top: 30,
    alignSelf: 'center',
    color: colors.muted,
  },
});
