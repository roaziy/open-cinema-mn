import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { chooseFonts } from './font-select';

// Metro only bundles what it can see statically: this picks up the gitignored Gilroy files when
// they exist locally and is simply empty otherwise.
const privateFonts = require.context('../../assets/fonts/private', false, /GIP-.*\.otf$/);
const choice = chooseFonts(privateFonts.keys());

/** Same family names as `fonts` in ./type.ts, which the config plugin also embeds in native builds. */
const sources =
  choice.family === 'GIP'
    ? Object.fromEntries(
        Object.entries(choice.files).map(([name, key]) => [name, privateFonts(key)]),
      )
    : {
        'Onest-Regular': require('../../assets/fonts/Onest-Regular.ttf'),
        'Onest-Medium': require('../../assets/fonts/Onest-Medium.ttf'),
        'Onest-SemiBold': require('../../assets/fonts/Onest-SemiBold.ttf'),
      };

const TIMEOUT_MS = 3000;

/** True once the fonts loaded, failed, or took too long: a font problem never blocks the app. */
export function useBrandFontsReady(): boolean {
  const [loaded, error] = useFonts(sources);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(id);
  }, []);
  return loaded || error != null || timedOut;
}
