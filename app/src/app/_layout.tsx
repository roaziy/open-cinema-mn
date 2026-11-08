import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ToastHost } from '@/components/toast-host';
import { hydrateLocale, useI18n } from '@/i18n';
import { getUserId, hydrateAuth } from '@/lib/auth';
import { hydrateBranch } from '@/lib/branch';
import { queryClient } from '@/lib/queries';
import { sweepTicketCache } from '@/lib/ticket-cache';
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
  const { t } = useI18n();

  useEffect(() => {
    // Auth known: drop stored tickets of any other account (or all of them with no session).
    hydrateAuth().then(() => sweepTicketCache(getUserId()));
    Promise.all([hydrateAuth(), hydrateLocale(), hydrateBranch()]).finally(() => {
      SplashScreen.hideAsync().catch(() => {});
    });
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.canvas }}>
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
                scrollEdgeEffects: { top: 'hidden' },
                headerTitleStyle: { fontFamily: fonts.semibold, color: colors.ink },
              }}
            />
            <Stack.Screen name="showtime/[id]" />
            <Stack.Screen name="showtime/[id]/view" />
            <Stack.Screen
              name="showtime/[id]/gate"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.7, 1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: colors.surface },
              }}
            />
            <Stack.Screen name="checkout/[showtimeId]" />
            <Stack.Screen name="pay/[bookingId]" />
            <Stack.Screen name="ticket/[id]" />
            <Stack.Screen
              name="login"
              options={{
                presentation: 'modal',
                contentStyle: { backgroundColor: colors.surface },
              }}
            />
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
          <ToastHost />
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
