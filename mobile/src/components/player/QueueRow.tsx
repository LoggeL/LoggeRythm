import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderHandlers,
} from 'react-native';
import type { Track } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { triggerHaptic } from '../../hooks/useHaptics';
import { strings } from '../../localization';
import type { TrackPresentationState } from '../../player/trackPresentation';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, layout, metrics, opacity, radii, spacing, typography } from '../../theme';
import AppIcon from '../AppIcon';
import TrackStateIndicator from '../TrackStateIndicator';
import { buildTrackMetadata } from '../track/trackMetadata';
import { trackStateIndicatorCopy } from '../track/trackPresentationCopy';
import { Artwork, createFocusRingController, FocusRingOverlay, IconButton } from '../ui';

export interface QueueRowProps {
  track: Track;
  /** `queue-row-<stable id>`; child controls derive their testIDs from it. */
  testID: string;
  /** The row is the item the native player currently has loaded. */
  active: boolean;
  presentation: TrackPresentationState;
  /** A queue mutation is running: every control of every row is blocked. */
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Responder props for the drag handle; absent when the row has nowhere to move. */
  dragHandlers?: GestureResponderHandlers;
  /** A floating copy of this row is being dragged; the row itself stays as a dimmed placeholder. */
  dragging?: boolean;
  /** The move-up/move-down buttons are revealed below the row. */
  moveControlsOpen?: boolean;
  /** The handle was activated by an assistive technology (a touch tap arrives through `dragHandlers`). */
  onToggleMoveControls?: () => void;
  rowRef?: React.Ref<View>;
  /** Android TV mode exposes direct D-Pad focusable move-up/move-down/remove actions instead of touch drag. */
  isTv?: boolean;
  onSkip: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onOpenAlbum?: (params: AlbumRouteParams) => void;
  onOpenArtist?: (params: ArtistRouteParams) => void;
}

/**
 * One queue entry: the full left track body (cover + title + artist/duration)
 * is one generous tap-to-skip button, while remove and reorder stay clear 48dp
 * targets that never overlap. On phones, dragging the handle reorders the row
 * and tapping it reveals move-up/move-down controls; on Android TV, direct
 * D-Pad focusable up/down/remove buttons make queue reordering one-click with a
 * remote.
 */
export function QueueRow({
  track,
  testID,
  active,
  presentation,
  disabled,
  canMoveUp,
  canMoveDown,
  dragHandlers,
  dragging = false,
  moveControlsOpen = false,
  onToggleMoveControls,
  rowRef,
  isTv = false,
  onSkip,
  onMoveUp,
  onMoveDown,
  onRemove,
}: QueueRowProps) {
  const canReorder = !disabled && dragHandlers !== undefined;
  const artistLabel = trackArtistLabel(track);
  const metadata = buildTrackMetadata(track);
  const subtitleParts: string[] = [artistLabel];
  if (active && metadata.album.trim().length > 0) {
    subtitleParts.push(metadata.album.trim());
  }
  if (metadata.duration !== null) {
    subtitleParts.push(metadata.duration);
  }
  const subtitle = subtitleParts.join(' · ');
  const rowFocus = createFocusRingController();

  return (
    <View
      ref={rowRef}
      // Measured for drag-and-drop: Android must not flatten this view away.
      collapsable={false}
      testID={testID}
      style={[
        styles.container,
        active ? styles.activeRow : null,
        dragging ? styles.dragging : null,
      ]}
    >
      <View style={styles.row}>
        <Pressable
          testID={`${testID}-track`}
          accessibilityRole="button"
          accessibilityLabel={strings.queue.skipLabel(track.title, artistLabel, active)}
          accessibilityHint={active ? undefined : strings.queue.skipHint}
          accessibilityState={{
            selected: active,
            busy: presentation.playback === 'buffering',
            disabled,
          }}
          disabled={disabled}
          focusable={!disabled}
          onFocus={() => rowFocus.setFocused(true)}
          onBlur={() => rowFocus.setFocused(false)}
          onPress={() => {
            triggerHaptic('tap');
            onSkip();
          }}
          style={({ pressed }) => [styles.trackBody, pressed ? styles.pressed : null]}
        >
          <View style={styles.cover}>
            <Artwork uri={track.cover} size={layout.artwork.sm} />
            {active ? (
              <View accessible={false} pointerEvents="none" style={styles.playingBadge}>
                <AppIcon name="equalizer" color={colors.onAccent} size={14} />
              </View>
            ) : null}
          </View>

          <View style={styles.metadata}>
            <Text
              testID={`${testID}-title`}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={active ? [styles.title, styles.titleActive] : styles.title}
            >
              {metadata.title}
            </Text>
            <Text
              testID={`${testID}-subtitle`}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={styles.subtitle}
            >
              {subtitle}
            </Text>
            <TrackStateIndicator
              presentation={presentation}
              copy={trackStateIndicatorCopy}
              testID={`${testID}-state`}
            />
          </View>
          <FocusRingOverlay controller={rowFocus} borderRadius={radii.md} disabled={disabled} />
        </Pressable>

        {active ? null : (
          <View style={styles.controls}>
            {isTv ? (
              <>
                <IconButton
                  testID={`${testID}-move-up`}
                  icon="chevron-up"
                  size="sm"
                  haptic="tap"
                  focusable
                  accessibilityLabel={strings.queue.moveUp(track.title)}
                  disabled={disabled || !canMoveUp}
                  onPress={onMoveUp}
                />
                <IconButton
                  testID={`${testID}-move-down`}
                  icon="chevron-down"
                  size="sm"
                  haptic="tap"
                  focusable
                  accessibilityLabel={strings.queue.moveDown(track.title)}
                  disabled={disabled || !canMoveDown}
                  onPress={onMoveDown}
                />
                <IconButton
                  testID={`${testID}-remove`}
                  icon="close"
                  size="sm"
                  haptic="tap"
                  focusable
                  accessibilityLabel={strings.queue.remove(track.title)}
                  disabled={disabled}
                  onPress={onRemove}
                />
              </>
            ) : (
              <>
                <IconButton
                  testID={`${testID}-remove`}
                  icon="close"
                  size="sm"
                  haptic="tap"
                  focusable
                  accessibilityLabel={strings.queue.remove(track.title)}
                  disabled={disabled}
                  onPress={onRemove}
                />
                <View
                  testID={`${testID}-drag-handle`}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={strings.queue.reorder(track.title)}
                  accessibilityHint={strings.queue.reorderHint}
                  accessibilityState={{ disabled: !canReorder, expanded: moveControlsOpen }}
                  accessibilityActions={[{ name: 'activate' }]}
                  onAccessibilityAction={(event: AccessibilityActionEvent) => {
                    if (canReorder && event.nativeEvent.actionName === 'activate') {
                      onToggleMoveControls?.();
                    }
                  }}
                  {...(canReorder ? dragHandlers : null)}
                  style={[styles.handle, canReorder ? null : styles.disabled]}
                >
                  <AppIcon name="drag-horizontal-variant" color={colors.textSecondary} size={24} />
                </View>
              </>
            )}
          </View>
        )}
      </View>

      {!active && !isTv && moveControlsOpen ? (
        <View testID={`${testID}-move-controls`} style={styles.moveControls}>
          <IconButton
            testID={`${testID}-move-up`}
            icon="chevron-up"
            haptic="tap"
            focusable
            accessibilityLabel={strings.queue.moveUp(track.title)}
            disabled={disabled || !canMoveUp}
            onPress={onMoveUp}
          />
          <IconButton
            testID={`${testID}-move-down`}
            icon="chevron-down"
            haptic="tap"
            focusable
            accessibilityLabel={strings.queue.moveDown(track.title)}
            disabled={disabled || !canMoveDown}
            onPress={onMoveDown}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Memoized wrapper for `QueueSurface` virtualized list rows; `QueueRow` stays direct-callable in unit tests. */
export const MemoQueueRow = React.memo(QueueRow);

const BADGE = 20;

const styles = StyleSheet.create({
  container: { borderRadius: radii.card },
  row: {
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    // Tight gaps pay for full, non-overlapping 48dp controls while the
    // title keeps its width on a 360dp screen.
    gap: spacing.xs,
    paddingLeft: spacing.xs,
    paddingVertical: spacing.xs,
  },
  activeRow: { paddingRight: spacing.sm, backgroundColor: colors.accentSubtle },
  dragging: { opacity: opacity.disabled },
  trackBody: {
    flex: 1,
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    paddingRight: spacing.xs,
  },
  cover: { width: layout.artwork.sm, height: layout.artwork.sm },
  playingBadge: {
    position: 'absolute',
    right: -spacing.xxs,
    bottom: -spacing.xxs,
    width: BADGE,
    height: BADGE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  metadata: { flex: 1, minWidth: 0, gap: spacing.xxs / 2 },
  title: { ...typography.bodyStrong, color: colors.textPrimary },
  titleActive: { color: colors.accentSoft },
  subtitle: { ...typography.callout, color: colors.textSecondary },
  controls: { flexDirection: 'row', alignItems: 'center' },
  handle: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveControls: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingBottom: spacing.xxs,
  },
  disabled: { opacity: opacity.disabled },
  pressed: { opacity: opacity.pressed },
});
