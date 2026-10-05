import React, { type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Track, TrackPlayCount } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { strings } from '../../localization';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import type { TrackOccurrenceIdentity } from '../../player/trackPresentation';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import TrackLikeButton from '../TrackLikeButton';
import TrackStateIndicator from '../TrackStateIndicator';
import AppIcon from '../AppIcon';
import { colors, metrics, radii, spacing } from '../../theme';
import TrackIdentityLinks from './TrackIdentityLinks';
import {
  buildTrackMetadata,
  type TrackPopularityPolicy,
} from './trackMetadata';
import {
  trackIdentityCopy,
  trackStateIndicatorCopy,
} from './trackPresentationCopy';

export type TrackOccurrenceTarget = Omit<TrackOccurrenceIdentity, 'trackId'>;

export interface StandardTrackRowProps {
  track: Track;
  testID: string;
  occurrence?: TrackOccurrenceTarget;
  position?: number;
  popularity?: TrackPopularityPolicy;
  plays?: TrackPlayCount;
  showAlbumLabel?: boolean;
  showDuration?: boolean;
  rollingDeviceCacheSeconds?: unknown;
  onPlay: () => void;
  onActions?: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
  trailingControls?: ReactNode;
  highlighted?: boolean;
}

/**
 * Shared vertical-row composition. Playback, catalog links, Like, More, and
 * owner controls are siblings, so no responder can swallow another action.
 * The owner remains authoritative for queue context and the exact row index.
 */
export default function StandardTrackRow({
  track,
  testID,
  occurrence,
  position,
  popularity = 'none',
  plays,
  showAlbumLabel = true,
  showDuration = true,
  rollingDeviceCacheSeconds,
  onPlay,
  onActions,
  onOpenAlbum,
  onOpenArtist,
  trailingControls,
  highlighted = false,
}: StandardTrackRowProps) {
  const presentation = useTrackPresentation(
    { trackId: track.id, ...occurrence },
    { rollingDeviceCacheSeconds },
  );
  const metadata = buildTrackMetadata(track, {
    popularity,
    ...(plays === undefined ? {} : { plays }),
  });
  const buffering = presentation.playback === 'buffering';

  return (
    <View
      testID={`${testID}-container`}
      style={[
        styles.container,
        ...(highlighted ? [styles.highlightedContainer] : []),
        ...(presentation.active ? [styles.activeContainer] : []),
      ]}
    >
      <View style={styles.row}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={strings.common.trackBy(track.title, trackArtistLabel(track))}
          accessibilityHint={
            onActions === undefined ? undefined : strings.trackActions.moreActionsHint
          }
          accessibilityActions={
            onActions === undefined
              ? undefined
              : [{ name: 'longpress', label: strings.trackActions.moreActionsLabel }]
          }
          accessibilityState={{ selected: presentation.active, busy: buffering }}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'longpress') onActions?.();
          }}
          onPress={onPlay}
          onLongPress={onActions}
          style={({ pressed }) => [styles.playTarget, pressed && styles.pressed]}
        >
          {track.cover ? (
            <Image accessible={false} source={{ uri: track.cover }} style={styles.artwork} />
          ) : (
            <View style={[styles.artwork, styles.placeholder]}>
              <AppIcon name="music-note" color={colors.accentSoft} size={21} />
            </View>
          )}
          {position !== undefined ? (
            <Text testID={`${testID}-position`} accessible={false} style={styles.position}>
              {position}
            </Text>
          ) : null}
          <View accessible={false} style={styles.playGlyphBadge}>
            {buffering ? (
              <ActivityIndicator color={colors.textPrimary} size={10} />
            ) : (
              <AppIcon
                name={presentation.playback === 'playing' ? 'pause' : 'play'}
                color={colors.textPrimary}
                size={12}
              />
            )}
          </View>
        </Pressable>
        <View style={styles.metadata}>
          <TrackIdentityLinks
            metadata={metadata}
            testID={`${testID}-identity`}
            copy={trackIdentityCopy}
            onOpenAlbum={onOpenAlbum}
            onOpenArtist={onOpenArtist}
            showAlbumLabel={showAlbumLabel}
            showDuration={showDuration}
            showPopularity={popularity !== 'none'}
          />
          <TrackStateIndicator
            presentation={presentation}
            copy={trackStateIndicatorCopy}
            testID={`${testID}-state`}
          />
        </View>
        <TrackLikeButton track={track} testID={`${testID}-like`} />
        {onActions !== undefined ? (
          <Pressable
            testID={`${testID}-actions`}
            accessibilityRole="button"
            accessibilityLabel={`${strings.trackActions.moreActionsLabel}: ${track.title}`}
            onPress={onActions}
            style={({ pressed }) => [styles.actions, pressed && styles.pressed]}
          >
            <AppIcon name="dots-vertical" color={colors.textSecondary} size={25} />
          </Pressable>
        ) : null}
      </View>
      {trailingControls === undefined ? null : (
        <View testID={`${testID}-trailing-controls`} style={styles.trailingControls}>
          {trailingControls}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 72,
    borderRadius: radii.md,
    marginHorizontal: spacing.xs,
    marginVertical: 2,
  },
  activeContainer: {
    backgroundColor: colors.accentSubtle,
  },
  highlightedContainer: {
    backgroundColor: colors.surfaceElevated,
  },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingLeft: spacing.xs,
  },
  position: {
    position: 'absolute',
    top: 2,
    left: 2,
    minWidth: 18,
    paddingHorizontal: 3,
    color: colors.textPrimary,
    backgroundColor: 'rgba(11,12,16,0.86)',
    borderRadius: 4,
    overflow: 'hidden',
    fontSize: 10,
    lineHeight: 16,
    textAlign: 'center',
  },
  playTarget: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: radii.sm,
    marginRight: spacing.sm,
  },
  artwork: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyphBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,12,16,0.86)',
  },
  metadata: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingRight: 6,
  },
  actions: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailingControls: { paddingLeft: spacing.xs, paddingRight: spacing.xs, paddingBottom: spacing.xs },
  pressed: { opacity: 0.72, backgroundColor: colors.surfacePressed },
});
