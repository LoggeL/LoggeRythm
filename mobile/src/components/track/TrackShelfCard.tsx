import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Track } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { strings } from '../../localization';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import TrackLikeButton from '../TrackLikeButton';
import TrackStateIndicator from '../TrackStateIndicator';
import { colors, layout, radii, spacing } from '../../theme';
import { IconButton, PressableScale } from '../ui';
import { TrackArtworkOverlay } from './TrackArtworkOverlay';
import TrackIdentityLinks from './TrackIdentityLinks';
import { buildTrackMetadata } from './trackMetadata';
import type { TrackOccurrenceTarget } from './StandardTrackRow';
import {
  trackIdentityCopy,
  trackStateIndicatorCopy,
} from './trackPresentationCopy';

export interface TrackShelfCardProps {
  track: Track;
  testID: string;
  occurrence?: TrackOccurrenceTarget;
  rank?: number;
  onPlay: () => void;
  onActions?: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

/**
 * The rail card of a track: the cover is the springy play target, identity
 * links sit below it and Like / More are sibling controls, so no action
 * overlaps another. The active occurrence is tinted like the active row.
 */
export default function TrackShelfCard({
  track,
  testID,
  occurrence,
  rank,
  onPlay,
  onActions,
  onOpenAlbum,
  onOpenArtist,
}: TrackShelfCardProps) {
  const presentation = useTrackPresentation({ trackId: track.id, ...occurrence });
  const buffering = presentation.playback === 'buffering';
  return (
    <View
      testID={`${testID}-container`}
      style={[styles.card, presentation.active && styles.activeCard]}
    >
      <PressableScale
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
        style={styles.artworkButton}
      >
        <TrackArtworkOverlay
          cover={track.cover}
          size={layout.artwork.card}
          presentation={presentation}
          badge={rank}
          badgeTone="accent"
        />
      </PressableScale>
      <View style={styles.identityRow}>
        <TrackIdentityLinks
          metadata={buildTrackMetadata(track)}
          testID={`${testID}-identity`}
          copy={trackIdentityCopy}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
          showAlbumLabel={false}
          showDuration={false}
          showPopularity={false}
          active={presentation.active}
        />
        <TrackStateIndicator
          presentation={presentation}
          copy={trackStateIndicatorCopy}
          testID={`${testID}-state`}
        />
      </View>
      <View style={styles.actionsRow}>
        <TrackLikeButton track={track} testID={`${testID}-like`} />
        {onActions === undefined ? null : (
          <IconButton
            testID={`${testID}-actions`}
            icon="dots-vertical"
            accessibilityLabel={`${strings.trackActions.moreActionsLabel}: ${track.title}`}
            onPress={onActions}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: layout.artwork.card, borderRadius: radii.card },
  activeCard: { backgroundColor: colors.accentSubtle },
  artworkButton: {
    width: layout.artwork.card,
    height: layout.artwork.card,
    borderRadius: radii.card,
  },
  identityRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: spacing.xs,
  },
  actionsRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
