import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Track } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { strings } from '../../localization';
import type { TrackPresentationState } from '../../player/trackPresentation';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, layout, opacity, radii, spacing } from '../../theme';
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
  onSkip: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

/**
 * One queue entry on a single line: the cover is the "skip to" button, the
 * identity links stay tappable next to it, and reorder/remove are 48dp icon
 * buttons that never overlap. The current item is tinted and carries an equalizer badge; it has
 * no reorder/remove controls because the native queue cannot move or drop
 * the loaded item.
 */
export function QueueRow({
  track,
  testID,
  active,
  presentation,
  disabled,
  canMoveUp,
  canMoveDown,
  onSkip,
  onMoveUp,
  onMoveDown,
  onRemove,
  onOpenAlbum,
  onOpenArtist,
}: QueueRowProps) {
  return (
    <View testID={testID} style={[styles.row, active ? styles.activeRow : null]}>
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
          <IconButton
            testID={`${testID}-remove`}
            icon="close"
            size="sm"
            accessibilityLabel={strings.queue.remove(track.title)}
            disabled={disabled}
            onPress={onRemove}
          />
        </View>
      )}
    </View>
  );
}

const BADGE = 20;

const styles = StyleSheet.create({
  row: {
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    // Tight gaps pay for three full, non-overlapping 48dp controls while the
    // title keeps its width on a 360dp screen.
    gap: spacing.xs,
    paddingLeft: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radii.card,
  },
  activeRow: { paddingRight: spacing.sm, backgroundColor: colors.accentSubtle },
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
  pressed: { opacity: opacity.pressed },
});
