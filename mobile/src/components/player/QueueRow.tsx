import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type GestureResponderHandlers,
} from 'react-native';
import type { Track } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { strings } from '../../localization';
import type { TrackPresentationState } from '../../player/trackPresentation';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import TrackStateIndicator from '../TrackStateIndicator';
import TrackIdentityLinks from '../track/TrackIdentityLinks';
import { buildTrackMetadata } from '../track/trackMetadata';
import {
  trackIdentityCopy,
  trackStateIndicatorCopy,
} from '../track/trackPresentationCopy';
import { Artwork, IconButton } from '../ui';

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
  onSkip: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

/**
 * One queue entry: the cover is the "skip to" button, the identity links stay
 * tappable next to it, and remove plus the drag handle are 48dp targets that
 * never overlap. Dragging the handle reorders the row; tapping it reveals the
 * move-up/move-down buttons on a second line for anyone who cannot drag. The
 * current item is tinted and carries an equalizer badge; it has no
 * reorder/remove controls because the native queue cannot move or drop the
 * loaded item.
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
  onSkip,
  onMoveUp,
  onMoveDown,
  onRemove,
  onOpenAlbum,
  onOpenArtist,
}: QueueRowProps) {
  const canReorder = !disabled && dragHandlers !== undefined;
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
          accessibilityLabel={strings.queue.skipLabel(track.title, trackArtistLabel(track), active)}
          accessibilityHint={active ? undefined : strings.queue.skipHint}
          accessibilityState={{
            selected: active,
            busy: presentation.playback === 'buffering',
            disabled,
          }}
          disabled={disabled}
          onPress={onSkip}
          style={({ pressed }) => [styles.cover, pressed ? styles.pressed : null]}
        >
          <Artwork uri={track.cover} size={layout.artwork.sm} />
          {active ? (
            <View accessible={false} pointerEvents="none" style={styles.playingBadge}>
              <AppIcon name="equalizer" color={colors.onAccent} size={14} />
            </View>
          ) : null}
        </Pressable>

        <View style={styles.metadata}>
          <TrackIdentityLinks
            metadata={buildTrackMetadata(track)}
            testID={`${testID}-identity`}
            copy={trackIdentityCopy}
            onOpenAlbum={onOpenAlbum}
            onOpenArtist={onOpenArtist}
            showAlbumLabel={active}
            showDuration
            showPopularity={false}
          />
          <TrackStateIndicator
            presentation={presentation}
            copy={trackStateIndicatorCopy}
            testID={`${testID}-state`}
          />
        </View>

        {active ? null : (
          <View style={styles.controls}>
            <IconButton
              testID={`${testID}-remove`}
              icon="close"
              size="sm"
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
          </View>
        )}
      </View>

      {!active && moveControlsOpen ? (
        <View testID={`${testID}-move-controls`} style={styles.moveControls}>
          <IconButton
            testID={`${testID}-move-up`}
            icon="chevron-up"
            accessibilityLabel={strings.queue.moveUp(track.title)}
            disabled={disabled || !canMoveUp}
            onPress={onMoveUp}
          />
          <IconButton
            testID={`${testID}-move-down`}
            icon="chevron-down"
            accessibilityLabel={strings.queue.moveDown(track.title)}
            disabled={disabled || !canMoveDown}
            onPress={onMoveDown}
          />
        </View>
      ) : null}
    </View>
  );
}

const BADGE = 20;

const styles = StyleSheet.create({
  container: { borderRadius: radii.card },
  row: {
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    // Tight gaps pay for two full, non-overlapping 48dp controls while the
    // title keeps its width on a 360dp screen.
    gap: spacing.xs,
    paddingLeft: spacing.xs,
    paddingVertical: spacing.xs,
  },
  activeRow: { paddingRight: spacing.sm, backgroundColor: colors.accentSubtle },
  dragging: { opacity: opacity.disabled },
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
  metadata: { flex: 1, minWidth: 0, gap: spacing.xxs },
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
