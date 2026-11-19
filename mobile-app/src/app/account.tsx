import { BadgeCheck, Mail, Phone } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EmailEditor } from '@/components/email-editor';
import { Field } from '@/components/field';
import { Pressable } from '@/components/pressable';
import { ICON_STROKE, SettingsRow, SettingsSection } from '@/components/settings-list';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { saveName } from '@/lib/profile';
import { showToast } from '@/lib/toast';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

export default function AccountScreen() {
  const { t } = useI18n();
  const { user } = useAuth();
  const saved = user?.name ?? '';
  const [name, setName] = useState(saved);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== saved;

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      await saveName(trimmed);
      haptic.success();
      showToast(t('account.saved'));
    } catch {
      haptic.error();
      showToast(t('error.generic'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.block}>
        <Text style={styles.group}>{t('account.name')}</Text>
        <Field
          onCanvas
          value={name}
          onChangeText={setName}
          placeholder={t('account.namePlaceholder')}
          maxLength={80}
          autoCapitalize="words"
          textContentType="name"
          returnKeyType="done"
          onSubmitEditing={save}
        />
        {dirty ? (
          <Pressable
            style={[styles.primary, busy && styles.disabled]}
            disabled={busy}
            onPress={save}
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
          >
            {busy ? (
              <ActivityIndicator color={colors.onAction} />
            ) : (
              <Text style={styles.primaryText}>{t('account.save')}</Text>
            )}
          </Pressable>
        ) : null}
      </View>

      <SettingsSection>
        {user.phone ? (
          <SettingsRow icon={Phone} label={t('profile.phone')} value={user.phone} />
        ) : null}
        <SettingsRow
          icon={Mail}
          label={t('profile.email')}
          value={user.email ?? t('account.emailMissing')}
        />
      </SettingsSection>
      {user.email && user.emailVerified ? (
        <View style={styles.verified}>
          <BadgeCheck size={16} color={colors.success} strokeWidth={ICON_STROKE} />
          <Text style={styles.verifiedText}>{t('profile.verified')}</Text>
        </View>
      ) : null}

      <EmailEditor hasEmail={!!user.email} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxxl },
  block: { gap: space.sm },
  group: { ...type.footnote, color: colors.muted, marginLeft: space.xs },
  primary: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    backgroundColor: colors.action,
  },
  primaryText: { ...type.headline, color: colors.onAction },
  disabled: { opacity: 0.4 },
  verified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: -space.sm,
    marginLeft: space.xs,
  },
  verifiedText: { ...type.caption, color: colors.success },
});
