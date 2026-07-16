import React, { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { strings, type AppLocale } from '../../localization';
import { useLocale } from '../../localization/LocaleProvider';
import { colors, metrics } from '../../theme';

interface LanguageSelectorViewProps {
  locale: AppLocale;
  ready: boolean;
  busy: boolean;
  error: string | null;
  onSelect(locale: AppLocale): void;
}

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
    <View testID="profile-language" style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        {strings.profile.languageTitle}
      </Text>
      <Text style={styles.subtitle}>
        {strings.profile.languageSubtitle}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={strings.profile.languageTitle}
        style={styles.options}
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
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.pressed,
                disabled && styles.disabled,
              ]}
            >
              <View style={[styles.indicator, selected && styles.indicatorSelected]}>
                {selected ? <View style={styles.indicatorDot} /> : null}
              </View>
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {busy ? (
        <Text
          testID="profile-language-status"
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          style={styles.status}
        >
          {strings.profile.languageChanging}
        </Text>
      ) : null}
      {error ? (
        <Text
          testID="profile-language-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.error}
        >
          {error}
        </Text>
      ) : null}
    </View>
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
  card: {
    gap: 12,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  options: { flexDirection: 'row', gap: 10 },
  option: {
    minHeight: metrics.minimumTouchTarget,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.surfacePressed },
  indicator: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.textSecondary,
  },
  indicatorSelected: { borderColor: colors.accent },
  indicatorDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  optionText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  optionTextSelected: { color: colors.textPrimary },
  status: { color: colors.textSecondary, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
});
