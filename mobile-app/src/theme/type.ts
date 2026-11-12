import Constants from 'expo-constants';
import type { TextStyle } from 'react-native';

// app.config.ts embeds Gilroy only when the private files exist, else Onest.
// iOS family name = the font's PostScript name, so both families use "<Name>-<Weight>".
const gilroy = Constants.expoConfig?.extra?.gilroy === true;
const prefix = gilroy ? 'GIP' : 'Onest';

/** Weights are limited to 400 / 500 / 600; never set fontWeight (it would synthesize bold). */
export const fonts = {
  regular: `${prefix}-Regular`,
  medium: `${prefix}-Medium`,
  semibold: `${prefix}-SemiBold`,
} as const;

const tabular: TextStyle['fontVariant'] = ['tabular-nums'];

export const type = {
  largeTitle: { fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, letterSpacing: 0.3 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: 0.2 },
  headline: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  footnote: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  /** Prices, counts, times, seat numbers. */
  number: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, fontVariant: tabular },
} as const satisfies Record<string, TextStyle>;
