/// <reference types="node" />
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const GILROY = ['Regular', 'Medium', 'SemiBold'].map((w) => `./assets/fonts/private/GIP-${w}.otf`);
const ONEST = ['Regular', 'Medium', 'SemiBold'].map((w) => `./assets/fonts/Onest-${w}.ttf`);

// Gilroy is commercial and never committed: it is embedded only when the gitignored
// files exist locally. Otherwise the bundled Onest (OFL) is used.
const hasGilroy = GILROY.every((f) => existsSync(resolve(__dirname, f)));
const fonts = hasGilroy ? GILROY : ONEST;

const CANVAS = '#0B0B0D';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: process.env.APP_NAME ?? 'Open Cinema',
  slug: 'open-cinema',
  scheme: 'opencinema',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: CANVAS,
  platforms: ['ios', 'android'],
  ios: {
    bundleIdentifier: process.env.APP_BUNDLE_ID ?? 'cloud.roaziy.opencinema',
    supportsTablet: false,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: process.env.APP_BUNDLE_ID ?? 'cloud.roaziy.opencinema',
    adaptiveIcon: {
      backgroundColor: CANVAS,
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-asset',
    [
      'expo-splash-screen',
      { backgroundColor: CANVAS, image: './assets/images/splash-icon.png', imageWidth: 96 },
    ],
    ['expo-font', { fonts }],
    'expo-secure-store',
    [
      'expo-calendar',
      {
        // Adding a ticket only needs write-only access (iOS 17+): the app never reads the calendar.
        writeOnlyAccess: true,
        // The app never touches reminders.
        remindersPermission: false,
        writeOnlyCalendarPermission:
          'Үзвэрийн цагийг календарьт нэмэхийн тулд хандах эрх хэрэгтэй. / Open Cinema adds your showtime to your calendar.',
        calendarPermission:
          'Үзвэрийн цагийг календарьт нэмэхийн тулд хандах эрх хэрэгтэй. / Open Cinema adds your showtime to your calendar.',
      },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    gilroy: hasGilroy,
  },
});
