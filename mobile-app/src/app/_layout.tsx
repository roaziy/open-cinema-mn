import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { EmailGate } from '@/components/email-gate';
import { ToastHost } from '@/components/toast-host';
import { hydrateLocale, useI18n } from '@/i18n';
import { getUserId, hydrateAuth } from '@/lib/auth';
import { hydrateBranch } from '@/lib/branch';
import { queryClient } from '@/lib/queries';
import { sweepTicketCache } from '@/lib/ticket-cache';
import { colors } from '@/theme/tokens';
import { fonts } from '@/theme/type';
import { useBrandFontsReady } from '@/theme/use-brand-fonts';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Native header with the page title, used by the plain list/text pages. */
const pageHeader = (title: string) =>
  ({
    headerShown: true,
    title,
    headerBackButtonDisplayMode: 'minimal',
    headerTintColor: colors.ink,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.canvas },
    headerTitleStyle: { fontFamily: fonts.semibold, color: colors.ink },
  }) as const;

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
  const fontsReady = useBrandFontsReady();
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    // Auth known: drop stored tickets of any other account (or all of them with no session).
    hydrateAuth().then(() => sweepTicketCache(getUserId()));
    Promise.all([hydrateAuth(), hydrateLocale(), hydrateBranch()]).finally(() => setBooted(true));
  }, []);

  useEffect(() => {
    if (booted && fontsReady) SplashScreen.hideAsync().catch(() => {});
  }, [booted, fontsReady]);

  // The splash screen stays up meanwhile; mounting text before its font exists would keep the system font.
  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          {/* dangerouslySingular: a screen is identified by its route and params, so a double tap
              (or two quick pushes) opens it once instead of stacking duplicates. */}
          <Stack
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="movie/[id]" dangerouslySingular />
            <Stack.Screen
              name="movie/[id]/showtimes"
              dangerouslySingular
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
            <Stack.Screen name="showtime/[id]" dangerouslySingular />
            <Stack.Screen
              name="showtime/[id]/gate"
              dangerouslySingular
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.7, 1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: colors.surface },
              }}
            />
            <Stack.Screen name="checkout/[showtimeId]" dangerouslySingular />
            <Stack.Screen name="pay/[bookingId]" dangerouslySingular />
            <Stack.Screen name="ticket/[id]" dangerouslySingular />
            <Stack.Screen
              name="login"
              dangerouslySingular
              options={{
                presentation: 'modal',
                contentStyle: { backgroundColor: colors.surface },
              }}
            />
            <Stack.Screen
              name="account"
              dangerouslySingular
              options={pageHeader(t('account.title'))}
            />
            <Stack.Screen
              name="points"
              dangerouslySingular
              options={pageHeader(t('points.title'))}
            />
            <Stack.Screen
              name="contact"
              dangerouslySingular
              options={pageHeader(t('contact.title'))}
            />
            <Stack.Screen name="terms" dangerouslySingular options={pageHeader(t('terms.title'))} />
            <Stack.Screen
              name="privacy"
              dangerouslySingular
              options={pageHeader(t('privacy.title'))}
            />
            <Stack.Screen
              name="email-required"
              dangerouslySingular
              options={{
                presentation: 'fullScreenModal',
                gestureEnabled: false,
                contentStyle: { backgroundColor: colors.canvas },
              }}
            />
            <Stack.Screen
              name="branches"
              dangerouslySingular
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: colors.surface },
              }}
            />
          </Stack>
          <EmailGate />
          <ToastHost />
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
