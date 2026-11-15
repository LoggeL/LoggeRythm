import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { strings } from '../../localization';
import { colors, radii, spacing, typography } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import { ActionButton } from './ActionButton';

export interface RetryButtonProps {
  onRetry: () => void;
  /** The retried request is in flight: shows a spinner and blocks presses. */
  busy?: boolean;
  /** Visible text. Defaults to strings.common.retry / retrying. */
  label?: string;
  /** Screen-reader name; pass one that names what is reloaded. */
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * RetryButton is the one retry control of the app: a secondary pill with a
 * refresh icon whose label and spinner follow `busy`. Every error surface
 * (ErrorState, inline notices, section errors) must use it instead of a
 * hand-built Pressable so wording, size and busy behaviour stay identical.
 */
export function RetryButton({
  onRetry,
  busy = false,
  label,
  accessibilityLabel,
  testID,
  style,
}: RetryButtonProps) {
  return (
    <ActionButton
      testID={testID}
      label={label ?? (busy ? strings.common.retrying : strings.common.retry)}
      accessibilityLabel={accessibilityLabel}
      busy={busy}
      icon="refresh"
      variant="secondary"
      onPress={onRetry}
      style={[styles.retry, style]}
    />
  );
}

export interface ErrorStateProps {
  /** User-facing, already localized and sanitized message. Never a raw error. */
  message: string;
  title?: string;
  /** offline swaps the glyph; wording stays the caller's. */
  kind?: 'error' | 'offline';
  /** page = centered, fills the screen; inline = bordered box inside content. */
  layout?: 'page' | 'inline';
  /** Omit only when the failure genuinely cannot be retried. */
  onRetry?: () => void;
  retryBusy?: boolean;
  retryLabel?: string;
  retryAccessibilityLabel?: string;
  testID?: string;
  retryTestID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * ErrorState presents a failed load: glyph, optional title, the message
 * (announced assertively as an alert) and the shared RetryButton. Use
 * `layout="page"` when the whole screen has no data and `layout="inline"`
 * for a failed section inside otherwise working content. It only renders
 * what it is given — it never invents or hides an error.
 */
export function ErrorState({
  message,
  title,
  kind = 'error',
  layout = 'inline',
  onRetry,
  retryBusy = false,
  retryLabel,
  retryAccessibilityLabel,
  testID,
  retryTestID,
  style,
}: ErrorStateProps) {
  const page = layout === 'page';
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[page ? styles.page : styles.inline, style]}
    >
      <AppIcon
        name={kind === 'offline' ? 'wifi-off' : 'alert-circle-outline'}
        color={kind === 'offline' ? colors.textSecondary : colors.danger}
        size={page ? 40 : 24}
      />
      {title ? (
        <Text style={[styles.title, page ? styles.centered : null]}>{title}</Text>
      ) : null}
      <Text style={[styles.message, page ? styles.centered : null]}>{message}</Text>
      {onRetry ? (
        <RetryButton
          testID={retryTestID}
          onRetry={onRetry}
          busy={retryBusy}
          label={retryLabel}
          accessibilityLabel={retryAccessibilityLabel}
          style={page ? styles.retryCentered : undefined}
        />
      ) : null}
    </View>
  );
}

export interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: AppIconName;
  /** Usually one ActionButton that resolves the emptiness. */
  action?: React.ReactNode;
  /** page = centered, fills the screen; inline = compact block inside content. */
  layout?: 'page' | 'inline';
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * EmptyState presents a successful but empty result: a soft glyph, a short
 * title, an optional explanation and an optional action that fixes it
 * ("Create playlist", "Search"). Empty is not an error — never use it for
 * a failed request; that is ErrorState.
 */
export function EmptyState({
  title,
  message,
  icon = 'music-box-multiple-outline',
  action,
  layout = 'inline',
  testID,
  style,
}: EmptyStateProps) {
  const page = layout === 'page';
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[page ? styles.page : styles.emptyInline, style]}
    >
      <View style={[styles.emptyGlyph, page ? styles.emptyGlyphPage : null]}>
        <AppIcon name={icon} color={colors.textMuted} size={page ? 36 : 26} />
      </View>
      <Text style={[page ? styles.title : styles.emptyTitle, styles.centered]}>{title}</Text>
      {message ? <Text style={[styles.message, styles.centered]}>{message}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xxl,
    backgroundColor: colors.background,
  },
  inline: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  emptyInline: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyGlyph: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.fill,
    marginBottom: spacing.xxs,
  },
  emptyGlyphPage: { width: 80, height: 80, marginBottom: spacing.xs },
  title: { ...typography.title, color: colors.textPrimary },
  emptyTitle: { ...typography.bodyStrong, color: colors.textPrimary },
  message: { ...typography.callout, color: colors.textSecondary },
  centered: { textAlign: 'center' },
  retry: { alignSelf: 'flex-start' },
  retryCentered: { alignSelf: 'center', marginTop: spacing.xs },
  action: { marginTop: spacing.sm },
});
