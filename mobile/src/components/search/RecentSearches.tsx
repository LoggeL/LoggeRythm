import React from 'react';
import { Pressable, StyleSheet, View, type TextStyle } from 'react-native';
import { triggerHaptic } from '../../hooks/useHaptics';
import { strings } from '../../localization';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import {
  AppText,
  FocusRingOverlay,
  SectionHeader,
  createFocusRingController,
} from '../ui';
import { SearchErrorNotice } from './SearchRemoteStates';
import type { RecentSearchesError } from './useRecentSearches';

export interface RecentSearchesProps {
  recent: readonly string[];
  error: RecentSearchesError | null;
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  onClear: () => void;
  onRetry?: () => void;
  /** Optional TV horizontal edge gutter override. */
  paddingHorizontal?: number;
  /** Minimum chip height (48dp phone, 52dp+ TV). */
  minTargetHeight?: number;
  /** Optional 10-foot TV label typography override. */
  labelStyle?: TextStyle;
  /** Optional TV focus-memory callback. */
  onChipFocus?: (focusKey: string) => void;
}

function errorMessage(error: RecentSearchesError): string {
  const base =
    error.kind === 'load' ? strings.search.recentLoadFailed : strings.search.recentSaveFailed;
  return error.detail.length > 0 ? `${base} (${error.detail})` : base;
}

/**
 * Account-scoped recent searches rendered in idle Search (matching `web/SearchIdle.tsx`).
 * Every chip and remove control is D-Pad focusable and storage failures surface loudly.
 */
export function RecentSearches({
  recent,
  error,
  onSelect,
  onRemove,
  onClear,
  onRetry,
  paddingHorizontal,
  minTargetHeight = metrics.minimumTouchTarget,
  labelStyle,
  onChipFocus,
}: RecentSearchesProps) {
  if (recent.length === 0 && error === null) return null;

  const clearController = createFocusRingController();
  const headerStyle =
    paddingHorizontal === undefined ? undefined : { paddingHorizontal };
  const chipsStyle =
    paddingHorizontal === undefined
      ? styles.chips
      : [styles.chips, { paddingHorizontal }];

  return (
    <View testID="search-recent" style={styles.section}>
      <SectionHeader
        title={strings.search.recentTitle}
        style={headerStyle}
        trailing={
          recent.length > 0 ? (
            <Pressable
              testID="search-recent-clear"
              accessibilityRole="button"
              accessibilityLabel={strings.search.recentClearLabel}
              focusable
              android_ripple={{ color: colors.fillStrong, borderless: true }}
              onFocus={() => {
                clearController.setFocused(true);
                onChipFocus?.('search-recent-clear');
              }}
              onBlur={() => clearController.setFocused(false)}
              onPress={() => {
                triggerHaptic('tap');
                onClear();
              }}
              style={({ pressed }) => [
                styles.clearButton,
                minTargetHeight !== metrics.minimumTouchTarget
                  ? { minHeight: minTargetHeight }
                  : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <AppText variant="caption" color="secondary" style={labelStyle}>
                {strings.search.recentClear}
              </AppText>
              <FocusRingOverlay controller={clearController} borderRadius={radii.pill} />
            </Pressable>
          ) : undefined
        }
      />
      {error !== null ? (
        <SearchErrorNotice
          testID="search-recent-error"
          message={errorMessage(error)}
          actionLabel={
            error.kind === 'load' && onRetry !== undefined
              ? strings.search.retrySection(strings.search.recentTitle)
              : undefined
          }
          onAction={error.kind === 'load' ? onRetry : undefined}
        />
      ) : null}
      {recent.length > 0 ? (
        <View style={chipsStyle}>
          {recent.map((term, index) => {
            const openController = createFocusRingController();
            const removeController = createFocusRingController();
            const openKey = `search-recent-open-${index}`;
            const removeKey = `search-recent-remove-${index}`;
            return (
              <View key={term} testID={`search-recent-item-${index}`} style={styles.chip}>
                <Pressable
                  testID={openKey}
                  accessibilityRole="button"
                  accessibilityLabel={strings.search.recentOpen(term)}
                  focusable
                  android_ripple={{ color: colors.fillStrong }}
                  onFocus={() => {
                    openController.setFocused(true);
                    onChipFocus?.(openKey);
                  }}
                  onBlur={() => openController.setFocused(false)}
                  onPress={() => {
                    triggerHaptic('tap');
                    onSelect(term);
                  }}
                  style={({ pressed }) => [
                    styles.chipMain,
                    minTargetHeight !== metrics.minimumTouchTarget
                      ? { minHeight: minTargetHeight }
                      : null,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <AppIcon name="history" color={colors.textMuted} size={16} />
                  <AppText variant="label" numberOfLines={1} style={[styles.chipText, labelStyle]}>
                    {term}
                  </AppText>
                  <FocusRingOverlay controller={openController} borderRadius={radii.pill} />
                </Pressable>
                <Pressable
                  testID={removeKey}
                  accessibilityRole="button"
                  accessibilityLabel={strings.search.recentRemove(term)}
                  focusable
                  android_ripple={{ color: colors.fillStrong, borderless: true }}
                  onFocus={() => {
                    removeController.setFocused(true);
                    onChipFocus?.(removeKey);
                  }}
                  onBlur={() => removeController.setFocused(false)}
                  onPress={() => {
                    triggerHaptic('tap');
                    onRemove(term);
                  }}
                  style={({ pressed }) => [
                    styles.chipRemove,
                    minTargetHeight !== metrics.minimumTouchTarget
                      ? { minHeight: minTargetHeight, minWidth: minTargetHeight }
                      : null,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <AppIcon name="close" color={colors.textMuted} size={16} />
                  <FocusRingOverlay controller={removeController} borderRadius={radii.pill} />
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.xs, paddingTop: spacing.md },
  clearButton: {
    minHeight: metrics.minimumTouchTarget,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: layout.pagePadding,
  },
  chip: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  chipMain: {
    minHeight: metrics.minimumTouchTarget,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  chipText: { flexShrink: 1 },
  chipRemove: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget - spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: spacing.xs,
  },
  pressed: { opacity: opacity.pressed },
});
