import React from 'react';
import { StyleSheet, View } from 'react-native';
import { triggerHaptic } from '../../hooks/useHaptics';
import { accountStrings } from '../../screens/accountStrings';
import { colors, layout, metrics, radii, spacing } from '../../theme';
import { TvFocusable, useTvEnvironment } from '../../tv';
import {
  androidUpdateAttention,
  useAndroidUpdateSnapshot,
  visibleAndroidUpdateStartupNotes,
  type AndroidUpdateSnapshot,
} from '../../update/androidUpdateStore';
import AppIcon, { type AppIconName } from '../AppIcon';
import { AppText, ListSeparator, SectionHeader, Surface } from '../ui';

export type ProfileAccountAppAttention = 'none' | 'update-available' | 'notice';

/**
 * Surfaces any Android update state that warrants a user's visit to Account &
 * App: an installable update (`update-available`), or a failure / startup note
 * the startup toast pointed to the profile for (`notice`).
 */
export function profileAccountAppAttention(
  snapshot: AndroidUpdateSnapshot,
): ProfileAccountAppAttention {
  if (!snapshot.supported) return 'none';
  const attention = androidUpdateAttention(snapshot);
  if (attention === 'update-available') return 'update-available';
  if (
    attention === 'install-failed'
    || visibleAndroidUpdateStartupNotes(snapshot).length > 0
    || snapshot.orphanedInstallFailure !== null
    || snapshot.check.kind === 'failed'
  ) {
    return 'notice';
  }
  return 'none';
}

export interface ProfileQuickActionsProps {
  onOpenInsights: () => void;
  onOpenSleepTimer: () => void;
  onOpenAudioEffects: () => void;
  onOpenDevices: () => void;
}

interface QuickActionItem {
  readonly testID: string;
  readonly focusKey: string;
  readonly icon: AppIconName;
  readonly label: string;
  readonly onPress: () => void;
}

/**
 * Compact 2x2 grid of high-frequency Profile actions (Insights, Sleep Timer,
 * Audio & Effects, Devices) so listeners reach them in one tap without digging
 * into settings pages.
 */
export function ProfileQuickActions({
  onOpenInsights,
  onOpenSleepTimer,
  onOpenAudioEffects,
  onOpenDevices,
}: ProfileQuickActionsProps) {
  const tv = useTvEnvironment();
  const copy = accountStrings.profile;
  const rows: readonly (readonly QuickActionItem[])[] = [
    [
      {
        testID: 'profile-open-insights',
        focusKey: 'profile-open-insights',
        icon: 'chart-areaspline',
        label: copy.quickInsights,
        onPress: onOpenInsights,
      },
      {
        testID: 'profile-quick-sleep-timer',
        focusKey: 'profile-quick-sleep-timer',
        icon: 'timer-outline',
        label: copy.quickSleepTimer,
        onPress: onOpenSleepTimer,
      },
    ],
    [
      {
        testID: 'profile-quick-audio-effects',
        focusKey: 'profile-quick-audio-effects',
        icon: 'equalizer',
        label: copy.quickAudioEffects,
        onPress: onOpenAudioEffects,
      },
      {
        testID: 'profile-quick-devices',
        focusKey: 'profile-quick-devices',
        icon: 'speaker-wireless',
        label: copy.quickDevices,
        onPress: onOpenDevices,
      },
    ],
  ];

  const tileMinHeight = tv.isTv ? tv.minFocusTargetHeight : metrics.minimumTouchTarget;

  return (
    <View testID="profile-quick-actions" style={styles.section}>
      <SectionHeader title={copy.quickAccessTitle} padded={false} />
      <View style={styles.quickGrid}>
        {rows.map((pair, rowIndex) => (
          <View key={rowIndex} style={styles.quickRow}>
            {pair.map((item) => (
              <TvFocusable
                key={item.testID}
                testID={item.testID}
                focusKey={item.focusKey}
                ringRadius="card"
                focusScale={1.02}
                containerStyle={styles.quickTileSlot}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                android_ripple={{ color: colors.fillStrong, borderless: false }}
                onPress={() => {
                  triggerHaptic('tap');
                  item.onPress();
                }}
                style={[styles.quickTile, { minHeight: tileMinHeight }]}
              >
                <View accessible={false} style={styles.quickIcon}>
                  <AppIcon name={item.icon} size={20} color={colors.accentSoft} />
                </View>
                <AppText variant="label" numberOfLines={1} style={styles.quickLabel}>
                  {item.label}
                </AppText>
              </TvFocusable>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

export interface ProfileSettingsMenuProps {
  onOpenPlaybackSettings: () => void;
  onOpenDevicesStorageSettings: () => void;
  onOpenAccountAppSettings: () => void;
}

export interface ProfileSettingsMenuViewProps extends ProfileSettingsMenuProps {
  accountAppAttention: ProfileAccountAppAttention;
}

interface SettingsMenuRow {
  readonly testID: string;
  readonly focusKey: string;
  readonly icon: AppIconName;
  readonly title: string;
  readonly summary: string;
  readonly attention: ProfileAccountAppAttention;
  readonly onPress: () => void;
}

const ROW_SEPARATOR_INSET = spacing.sm + layout.artwork.xs + spacing.sm;

/**
 * Pure presentation of the grouped thematic settings list on Profile: one
 * Surface with three clear destinations and concise, non-duplicated summaries.
 */
export function ProfileSettingsMenuView({
  onOpenPlaybackSettings,
  onOpenDevicesStorageSettings,
  onOpenAccountAppSettings,
  accountAppAttention,
}: ProfileSettingsMenuViewProps) {
  const tv = useTvEnvironment();
  const copy = accountStrings.profile;
  const rows: readonly SettingsMenuRow[] = [
    {
      testID: 'profile-nav-playback',
      focusKey: 'profile-nav-playback',
      icon: 'tune-variant',
      title: copy.settingsPlaybackTitle,
      summary: copy.settingsPlaybackSummary,
      attention: 'none',
      onPress: onOpenPlaybackSettings,
    },
    {
      testID: 'profile-nav-devices-storage',
      focusKey: 'profile-nav-devices-storage',
      icon: 'devices',
      title: copy.settingsDevicesStorageTitle,
      summary: copy.settingsDevicesStorageSummary,
      attention: 'none',
      onPress: onOpenDevicesStorageSettings,
    },
    {
      testID: 'profile-nav-account-app',
      focusKey: 'profile-nav-account-app',
      icon: 'account-cog-outline',
      title: copy.settingsAccountAppTitle,
      summary: copy.settingsAccountAppSummary,
      attention: accountAppAttention,
      onPress: onOpenAccountAppSettings,
    },
  ];

  const rowMinHeight = tv.isTv ? tv.minFocusTargetHeight : metrics.minimumTouchTarget;

  return (
    <View testID="profile-settings-section" style={styles.section}>
      <SectionHeader title={copy.settingsSectionTitle} padded={false} />
      <Surface testID="profile-settings-menu" style={styles.menuCard}>
        {rows.map((row, index) => {
          const attentionLabel =
            row.attention === 'update-available'
              ? copy.settingsAccountAppUpdateAvailable
              : row.attention === 'notice'
                ? copy.settingsAccountAppUpdateNotice
                : null;
          const accessibilityLabel = attentionLabel !== null
            ? `${row.title}, ${attentionLabel}. ${row.summary}`
            : `${row.title}. ${row.summary}`;

          return (
            <React.Fragment key={row.testID}>
              {index > 0 ? <ListSeparator inset={ROW_SEPARATOR_INSET} /> : null}
              <TvFocusable
                testID={row.testID}
                focusKey={row.focusKey}
                ringRadius="md"
                focusScale={1.01}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityHint={copy.openSettings(row.title)}
                android_ripple={{ color: colors.fillStrong, borderless: false }}
                onPress={() => {
                  triggerHaptic('tap');
                  row.onPress();
                }}
                style={[styles.menuRow, { minHeight: rowMinHeight }]}
              >
                <View accessible={false} style={styles.rowGlyph}>
                  <AppIcon name={row.icon} size={20} color={colors.accentSoft} />
                </View>
                <View style={styles.rowCopy}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {row.title}
                  </AppText>
                  <AppText variant="callout" color="secondary" numberOfLines={2}>
                    {row.summary}
                  </AppText>
                </View>
                {row.attention !== 'none' ? (
                  <View
                    testID="profile-account-app-update-dot"
                    accessible={false}
                    importantForAccessibility="no"
                    style={[
                      styles.attentionDot,
                      row.attention === 'notice' ? styles.attentionDotNotice : null,
                    ]}
                  />
                ) : null}
                <AppIcon name="chevron-right" size={20} color={colors.textMuted} />
              </TvFocusable>
            </React.Fragment>
          );
        })}
      </Surface>
    </View>
  );
}

/** Settings navigation menu wired to live Android update attention state. */
export function ProfileSettingsMenu(props: ProfileSettingsMenuProps) {
  const snapshot = useAndroidUpdateSnapshot();
  return (
    <ProfileSettingsMenuView
      {...props}
      accountAppAttention={profileAccountAppAttention(snapshot)}
    />
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.xs,
  },
  quickGrid: {
    gap: spacing.xs,
  },
  quickRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  quickTileSlot: {
    flex: 1,
    minWidth: 0,
  },
  quickTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  quickIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  quickLabel: {
    flex: 1,
    minWidth: 0,
  },
  menuCard: {
    padding: spacing.xxs,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.md,
  },
  rowGlyph: {
    width: layout.artwork.xs,
    height: layout.artwork.xs,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs / 2,
  },
  attentionDot: {
    width: metrics.badgeDot - metrics.badgeDotRing,
    height: metrics.badgeDot - metrics.badgeDotRing,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  attentionDotNotice: {
    backgroundColor: colors.warning,
  },
});
