export const WEIGHTS = ['Regular', 'Medium', 'SemiBold'] as const;
export type FontWeightName = (typeof WEIGHTS)[number];

export type FontChoice =
  | { family: 'GIP'; files: Record<string, string> }
  | { family: 'Onest'; files: null };

/**
 * Picks the brand family from the private font files Metro found (`require.context` keys such as
 * `./GIP-Regular.otf`). Gilroy needs all three weights; otherwise the bundled Onest is used.
 * `files` maps the registered family name (`GIP-Regular`) to its context key.
 */
export function chooseFonts(keys: readonly string[]): FontChoice {
  const files: Record<string, string> = {};
  for (const w of WEIGHTS) {
    const key = keys.find((k) => k.endsWith(`/GIP-${w}.otf`) || k === `GIP-${w}.otf`);
    if (!key) return { family: 'Onest', files: null };
    files[`GIP-${w}`] = key;
  }
  return { family: 'GIP', files };
}
