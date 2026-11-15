import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Track, TrackPlayCount } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { strings } from '../../localization';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import type { TrackOccurrenceIdentity } from '../../player/trackPresentation';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import TrackLikeButton from '../TrackLikeButton';
import TrackStateIndicator from '../TrackStateIndicator';
import { colors, layout, opacity, radii, spacing } from '../../theme';
import { AppText, IconButton } from '../ui';
import { TrackArtworkOverlay } from './TrackArtworkOverlay';
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
  /**
   * One bounded collection fact under the identity (e.g. Radar release
   * recency). Rendered as `${testID}-metadata`; omitted when undefined.
   */
  caption?: string;
}

/**
 * The canonical vertical track row: cover (the play target), identity links,
 * state evidence, Like and overflow. Playback, catalog links, Like, More and
 * owner controls are siblings, so no responder can swallow another action.
 * The active occurrence is tinted and its title turns accent; the owner
 * remains authoritative for queue context and the exact row index.
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
  caption,
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
          <TrackArtworkOverlay
            cover={track.cover}
            size={layout.artwork.sm}
            presentation={presentation}
            badge={position}
            badgeTestID={`${testID}-position`}
          />
        </Pressable>
        <View style={styles.copy}>
          <View style={styles.identityLine}>
            <TrackIdentityLinks
              metadata={metadata}
              testID={`${testID}-identity`}
              copy={trackIdentityCopy}
              onOpenAlbum={onOpenAlbum}
              onOpenArtist={onOpenArtist}
              showAlbumLabel={showAlbumLabel}
              showDuration={showDuration}
              showPopularity={popularity !== 'none'}
              active={presentation.active}
            />
            <TrackStateIndicator
              presentation={presentation}
              copy={trackStateIndicatorCopy}
              testID={`${testID}-state`}
            />
          </View>
          {caption === undefined ? null : (
            <AppText
              testID={`${testID}-metadata`}
              accessibilityLabel={caption}
              variant="caption"
              color={highlighted ? 'accent' : 'muted'}
              numberOfLines={2}
            >
              {caption}
            </AppText>
          )}
        </View>
        <TrackLikeButton track={track} testID={`${testID}-like`} />
        {onActions !== undefined ? (
          <IconButton
            testID={`${testID}-actions`}
            icon="dots-vertical"
            accessibilityLabel={`${strings.trackActions.moreActionsLabel}: ${track.title}`}
            onPress={onActions}
          />
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
  // The 8dp outer margin plus the 12dp inner inset put the cover on the 20dp
  // page gutter while the active tint still bleeds past it.
  container: {
    minHeight: layout.rowHeight,
    borderRadius: radii.md,
    marginHorizontal: spacing.xs,
  },
  activeContainer: { backgroundColor: colors.accentSubtle },
  highlightedContainer: { backgroundColor: colors.surface },
  row: {
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xxs,
  },
  playTarget: {
    width: layout.artwork.sm,
    height: layout.artwork.sm,
    borderRadius: radii.sm,
    marginRight: spacing.sm,
  },
  copy: { minWidth: 0, flex: 1, justifyContent: 'center', paddingRight: spacing.xxs },
  identityLine: { minWidth: 0, flexDirection: 'row', alignItems: 'flex-end' },
  trailingControls: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  pressed: { opacity: opacity.pressed },
});
