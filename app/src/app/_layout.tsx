import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { hydrateLocale, useI18n } from '@/i18n';
import { ensureGuest, hydrateAuth, useAuth } from '@/lib/auth';
import { hydrateBranch } from '@/lib/branch';
import { queryClient } from '@/lib/queries';
import { colors } from '@/theme/tokens';
import { fonts } from '@/theme/type';

SplashScreen.preventAutoHideAsync().catch(() => {});

const theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: colors.action,
    background: colors.canvas,
    card: colors.surface,
    text: colors.ink,
    border: colors.hairline,
    notification: colors.danger,
  },
};

export default function RootLayout() {
  const { ready, user } = useAuth();
  const { t } = useI18n();

  useEffect(() => {
    Promise.all([hydrateAuth(), hydrateLocale(), hydrateBranch()]).finally(() => {
      SplashScreen.hideAsync().catch(() => {});
    });
  }, []);

  // Everyone is at least a guest: start one in the background after launch and after logout.
  // Offline failures are fine; the next api() call retries.
  useEffect(() => {
    if (ready && !user) ensureGuest().catch(() => {});
  }, [ready, user]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="movie/[id]" />
          <Stack.Screen
            name="movie/[id]/showtimes"
            options={{
              headerShown: true,
              title: t('showtimes.title'),
              headerBackButtonDisplayMode: 'minimal',
              headerTintColor: colors.ink,
              headerTransparent: true,
              headerTitleStyle: { fontFamily: fonts.semibold, color: colors.ink },
            }}
          />
          <Stack.Screen name="showtime/[id]" />
          <Stack.Screen
            name="branches"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
              contentStyle: { backgroundColor: colors.surface },
            }}
          />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
