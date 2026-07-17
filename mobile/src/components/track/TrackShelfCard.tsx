import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Track } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { strings } from '../../localization';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import TrackLikeButton from '../TrackLikeButton';
import TrackStateIndicator from '../TrackStateIndicator';
import AppIcon from '../AppIcon';
import { colors, metrics } from '../../theme';
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

/** Production-style rail card with non-overlapping Play, identity, Like, More. */
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
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={strings.common.trackBy(track.title, trackArtistLabel(track))}
        accessibilityState={{ selected: presentation.active, busy: buffering }}
        onPress={onPlay}
        style={({ pressed }) => [styles.artworkButton, pressed && styles.pressed]}
      >
        {track.cover ? (
          <Image accessible={false} source={{ uri: track.cover }} style={styles.artwork} />
        ) : (
          <View style={[styles.artwork, styles.placeholder]}>
            <AppIcon name="music-note" color={colors.accentSoft} size={29} />
          </View>
        )}
        {rank !== undefined ? <Text style={styles.rankBadge}>{rank}</Text> : null}
        <View accessible={false} style={styles.playBadge}>
          {buffering ? (
            <ActivityIndicator color={colors.textPrimary} size="small" />
          ) : (
            <AppIcon
              name={presentation.playback === 'playing' ? 'pause' : 'play'}
              color={colors.textPrimary}
              size={20}
            />
          )}
        </View>
      </Pressable>
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
          <Pressable
            testID={`${testID}-actions`}
            accessibilityRole="button"
            accessibilityLabel={`${strings.trackActions.moreActionsLabel}: ${track.title}`}
            onPress={onActions}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <AppIcon name="dots-vertical" color={colors.textSecondary} size={25} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: 176, minHeight: 272, padding: 8, borderRadius: 14 },
  activeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  artworkButton: { width: 160, height: 160, borderRadius: 12 },
  artwork: {
    width: 160,
    height: 160,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  rankBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    textAlign: 'center',
    lineHeight: 28,
    overflow: 'hidden',
    color: colors.onAccent,
    backgroundColor: colors.accent,
    fontWeight: '900',
  },
  playBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: metrics.minimumTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,20,0.86)',
  },
  identityRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 5,
  },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  action: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.72, backgroundColor: colors.surfacePressed },
});
