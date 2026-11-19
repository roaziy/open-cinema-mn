import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { CircleUserRound, Film, Ticket } from 'lucide-react-native';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors } from '@/theme/tokens';
import { fonts } from '@/theme/type';

// Lucide line icons (Clapperboard, Ticket, CircleUserRound) rendered to template PNGs: the native
// tab bar takes images, not React components, and tints them itself.
const MOVIES = require('../../../assets/images/tabs/movies.png');
const TICKETS = require('../../../assets/images/tabs/tickets.png');
const PROFILE = require('../../../assets/images/tabs/profile.png');

/** iOS: Apple's own tab bar (Liquid Glass on iOS 26). Android: JS tabs, same dark styling. */
export default function TabsLayout() {
  return process.env.EXPO_OS === 'ios' ? <IosTabs /> : <AndroidTabs />;
}

function IosTabs() {
  const { t } = useI18n();
  return (
    <NativeTabs
      tintColor={colors.action}
      iconColor={{ default: colors.muted, selected: colors.action }}
      labelStyle={{ fontFamily: fonts.medium, fontSize: 11 }}
      backgroundColor={colors.surface}
      shadowColor={colors.hairline}
      screenListeners={{ tabPress: haptic.select }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon src={MOVIES} renderingMode="template" />
        <NativeTabs.Trigger.Label>{t('tabs.movies')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tickets">
        <NativeTabs.Trigger.Icon src={TICKETS} renderingMode="template" />
        <NativeTabs.Trigger.Label>{t('tabs.tickets')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon src={PROFILE} renderingMode="template" />
        <NativeTabs.Trigger.Label>{t('tabs.profile')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function AndroidTabs() {
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.action,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.hairline },
        sceneStyle: { backgroundColor: colors.canvas },
      }}
      screenListeners={{ tabPress: haptic.select }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.movies'),
          tabBarIcon: ({ color, size }) => (
            <Film color={color as string} size={size} strokeWidth={1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="tickets"
        options={{
          title: t('tabs.tickets'),
          tabBarIcon: ({ color, size }) => (
            <Ticket color={color as string} size={size} strokeWidth={1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, size }) => (
            <CircleUserRound color={color as string} size={size} strokeWidth={1.75} />
          ),
        }}
      />
    </Tabs>
  );
}
