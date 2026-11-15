import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import { AppText, RetryButton, type AppTextColor } from '../ui';

export type InlineNoticeTone = 'warning' | 'danger' | 'neutral';

export interface InlineNoticeRetry {
  onRetry: () => void;
  busy: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

export interface InlineNoticeProps {
  /** Already localized, user-facing copy. Never a raw error message. */
  message: string;
  title?: string;
  tone?: InlineNoticeTone;
  /** `assertive` for failures of something the user just did, `polite` for background state. */
  live?: 'polite' | 'assertive';
  retry?: InlineNoticeRetry;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const tones: Record<
  InlineNoticeTone,
  { icon: AppIconName; glyph: string; text: AppTextColor; background: string }
> = {
  warning: {
    icon: 'cloud-off-outline',
    glyph: colors.warning,
    text: 'warning',
    background: colors.warningSubtle,
  },
  danger: {
    icon: 'alert-circle-outline',
    glyph: colors.danger,
    text: 'danger',
    background: colors.dangerSubtle,
  },
  neutral: {
    icon: 'information-outline',
    glyph: colors.textSecondary,
    text: 'secondary',
    background: colors.surface,
  },
};

/**
 * The one non-blocking notice of the Library and Playlist screens: a tinted
 * card announced as an alert, shown above or below content that stays
 * mounted (cached data, a failed action, an offline copy). Retryable notices
 * carry the shared RetryButton.
 */
export function InlineNotice({
  message,
  title,
  tone = 'warning',
  live = 'polite',
  retry,
  testID,
  style,
}: InlineNoticeProps) {
  const look = tones[tone];
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion={live}
      style={[styles.notice, { backgroundColor: look.background }, style]}
    >
      <View style={styles.line}>
        <AppIcon name={look.icon} color={look.glyph} size={20} />
        <View style={styles.copy}>
          {title === undefined ? null : <AppText variant="bodyStrong">{title}</AppText>}
          <AppText variant="callout" color={title === undefined ? look.text : 'secondary'}>
            {message}
          </AppText>
        </View>
      </View>
      {retry === undefined ? null : (
        <RetryButton
          testID={retry.testID}
          accessibilityLabel={retry.accessibilityLabel}
          busy={retry.busy}
          onRetry={retry.onRetry}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.card },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
});
