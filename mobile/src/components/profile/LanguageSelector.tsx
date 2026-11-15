import React, { useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { strings, type AppLocale } from '../../localization';
import { useLocale } from '../../localization/LocaleProvider';
import { colors, metrics, opacity, radii, spacing } from '../../theme';
import { AppText } from '../ui';
import { ProfileGroup } from './ProfileGroup';

interface LanguageSelectorViewProps {
  locale: AppLocale;
  ready: boolean;
  busy: boolean;
  error: string | null;
  onSelect(locale: AppLocale): void;
}

/**
 * LanguageSelectorView is the app-language setting: a settings row with a
 * two-option segmented radio group. Both options lock while the choice is
 * being persisted; the saving status and a persistence failure appear below.
 */
export function LanguageSelectorView({
  locale,
  ready,
  busy,
  error,
  onSelect,
}: LanguageSelectorViewProps) {
  const disabled = !ready || busy;
  const options: readonly { locale: AppLocale; label: string }[] = [
    { locale: 'de', label: strings.profile.languageGerman },
    { locale: 'en', label: strings.profile.languageEnglish },
  ];

  return (
    <ProfileGroup
      testID="profile-language"
      icon="translate"
      title={strings.profile.languageTitle}
      description={strings.profile.languageSubtitle}
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={strings.profile.languageTitle}
        style={[styles.segments, disabled ? styles.disabled : null]}
      >
        {options.map((option) => {
          const selected = option.locale === locale;
          return (
            <Pressable
              key={option.locale}
              testID={`profile-language-${option.locale}`}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected, disabled, busy }}
              disabled={disabled}
              onPress={() => onSelect(option.locale)}
              style={({ pressed }) => [
                styles.segment,
                selected ? styles.segmentSelected : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <AppText variant="label" color={selected ? 'onLight' : 'secondary'} numberOfLines={1}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {busy ? (
        <AppText
          testID="profile-language-status"
          variant="callout"
          color="secondary"
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
        >
          {strings.profile.languageChanging}
        </AppText>
      ) : null}
      {error ? (
        <AppText
          testID="profile-language-error"
          variant="callout"
          color="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {error}
        </AppText>
      ) : null}
    </ProfileGroup>
  );
}

export default function LanguageSelector() {
  const { locale, ready, selectLocale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionLocked = useRef(false);

  const select = async (next: AppLocale) => {
    if (selectionLocked.current || !ready || next === locale) return;
    selectionLocked.current = true;
    setBusy(true);
    setError(null);
    try {
      await selectLocale(next);
      const label = next === 'de'
        ? strings.profile.languageGerman
        : strings.profile.languageEnglish;
      AccessibilityInfo.announceForAccessibility(strings.profile.languageChanged(label));
    } catch {
      setError(strings.profile.languageChangeFailed);
    } finally {
      selectionLocked.current = false;
      setBusy(false);
    }
  };

  return (
    <LanguageSelectorView
      locale={locale}
      ready={ready}
      busy={busy}
      error={error}
      onSelect={(next) => void select(next)}
    />
  );
}

const styles = StyleSheet.create({
  segments: {
    flexDirection: 'row',
    gap: spacing.xxs,
    padding: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },
  segmentSelected: { backgroundColor: colors.textPrimary },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});
