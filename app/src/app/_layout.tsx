import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { hydrateLocale } from '@/i18n';
import { ensureGuest, hydrateAuth, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/queries';
import { colors } from '@/theme/tokens';

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

  useEffect(() => {
    Promise.all([hydrateAuth(), hydrateLocale()]).finally(() => {
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
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
