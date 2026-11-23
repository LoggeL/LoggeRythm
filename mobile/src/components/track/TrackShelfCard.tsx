import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Track } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { strings } from '../../localization';
import type { TrackPresentationState } from '../../player/trackPresentation';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import TrackLikeButton from '../TrackLikeButton';
import TrackStateIndicator, { MemoEqualizerBars } from '../TrackStateIndicator';
import { colors, layout, radii, spacing } from '../../theme';
import { IconButton, PressableScale, type TvFocusProps } from '../ui';
import { TrackArtworkOverlay } from './TrackArtworkOverlay';
import TrackIdentityLinks from './TrackIdentityLinks';
import { buildTrackMetadata } from './trackMetadata';
import type { TrackOccurrenceTarget } from './StandardTrackRow';
import {
  trackIdentityCopy,
  trackStateIndicatorCopy,
} from './trackPresentationCopy';

export interface TrackShelfCardProps extends TvFocusProps {
  track: Track;
  testID: string;
  occurrence?: TrackOccurrenceTarget;
  rank?: number;
  onPlay: () => void;
  onActions?: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

export interface TrackShelfCardViewProps extends Omit<TrackShelfCardProps, 'occurrence'> {
  presentation: TrackPresentationState;
}

function samePresentation(
  left: TrackPresentationState,
  right: TrackPresentationState,
): boolean {
  return (
    left.active === right.active
    && left.playback === right.playback
    && left.serverCache === right.serverCache
    && left.explicitDownload.kind === right.explicitDownload.kind
    && left.rollingDeviceCache?.seconds === right.rollingDeviceCache?.seconds
  );
}

export function areTrackShelfCardViewPropsEqual(
  previous: TrackShelfCardViewProps,
  next: TrackShelfCardViewProps,
): boolean {
  return (
    previous.track === next.track
    && previous.testID === next.testID
    && previous.rank === next.rank
    && previous.onPlay === next.onPlay
    && previous.onActions === next.onActions
    && previous.onOpenAlbum === next.onOpenAlbum
    && previous.onOpenArtist === next.onOpenArtist
    && previous.focusable === next.focusable
    && previous.hasTVPreferredFocus === next.hasTVPreferredFocus
    && previous.onFocus === next.onFocus
    && previous.onBlur === next.onBlur
    && previous.focused === next.focused
    && previous.focusedStyle === next.focusedStyle
    && samePresentation(previous.presentation, next.presentation)
  );
}

export function TrackShelfCardView({
  track,
  testID,
  rank,
  onPlay,
  onActions,
  onOpenAlbum,
  onOpenArtist,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused,
  focusedStyle,
  presentation,
}: TrackShelfCardViewProps) {
  const buffering = presentation.playback === 'buffering';
  const showEqualizer =
    presentation.active
    && (presentation.playback === 'playing' || presentation.playback === 'paused');

  return (
    <View
      testID={`${testID}-container`}
      collapsable={false}
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
        focusable={focusable}
        hasTVPreferredFocus={hasTVPreferredFocus}
        focused={focused}
        focusedStyle={focusedStyle}
        onFocus={onFocus}
        onBlur={onBlur}
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
        {showEqualizer ? (
          <MemoEqualizerBars
            testID={`${testID}-equalizer`}
            bars={3}
            height={14}
            isPlaying={presentation.playback === 'playing'}
          />
        ) : null}
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

const MemoTrackShelfCardView = React.memo(
  TrackShelfCardView,
  areTrackShelfCardViewPropsEqual,
);

/**
 * The rail card of a track: the cover is the springy play target, identity
 * links sit below it and Like / More are sibling controls, so no action
 * overlaps another. The active occurrence is tinted like the active row.
 */
export default function TrackShelfCard({
  track,
  occurrence,
  ...rest
}: TrackShelfCardProps) {
  const presentation = useTrackPresentation({ trackId: track.id, ...occurrence });
  return (
    <MemoTrackShelfCardView
      {...rest}
      track={track}
      presentation={presentation}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    width: layout.artwork.card,
    borderRadius: radii.card,
    backgroundColor: 'transparent',
  },
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
