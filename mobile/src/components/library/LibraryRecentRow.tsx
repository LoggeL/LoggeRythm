import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RecentPlay } from '../../domain/listeningStats';
import { strings } from '../../localization';
import type { TrackOccurrenceIdentity } from '../../player/trackPresentation';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, metrics } from '../../theme';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import TrackStateIndicator from '../TrackStateIndicator';
import AppIcon from '../AppIcon';
import TrackIdentityLinks from '../track/TrackIdentityLinks';
import { buildTrackMetadata } from '../track/trackMetadata';
import {
  trackIdentityCopy,
  trackStateIndicatorCopy,
} from '../track/trackPresentationCopy';

export interface LibraryRecentRowProps {
  play: RecentPlay;
  index: number;
  testID: string;
  occurrence: Omit<TrackOccurrenceIdentity, 'trackId'>;
  busy: boolean;
  disabled: boolean;
  onPlay: () => void;
  onActions: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

function Artwork({
  play,
  busy,
  playback,
}: {
  play: RecentPlay;
  busy: boolean;
  playback: 'inactive' | 'buffering' | 'playing' | 'paused' | 'active';
}) {
  const buffering = busy || playback === 'buffering';
  return (
    <View style={styles.artworkFrame}>
      {play.cover ? (
        <Image accessible={false} source={{ uri: play.cover }} style={styles.artwork} />
      ) : (
        <View style={[styles.artwork, styles.artworkPlaceholder]}>
          <AppIcon name="music-note" color={colors.accentSoft} size={21} />
        </View>
      )}
      <View accessible={false} style={styles.playBadge}>
        {buffering ? (
          <ActivityIndicator color={colors.onAccent} size="small" />
        ) : (
          <AppIcon
            name={playback === 'playing' ? 'pause' : 'play'}
            color={colors.onAccent}
            size={16}
          />
        )}
      </View>
    </View>
  );
}

/** Keep history playback and catalog destinations as separate, non-overlapping responders. */
export function LibraryRecentRow({
  play,
  index,
  testID,
  occurrence,
  busy,
  disabled,
  onPlay,
  onActions,
  onOpenAlbum,
  onOpenArtist,
}: LibraryRecentRowProps) {
  const presentation = useTrackPresentation({ trackId: play.id, ...occurrence });
  const metadata = buildTrackMetadata(play);
  return (
    <View
      testID={`${testID}-container`}
      style={[styles.row, presentation.active && styles.activeRow]}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={libraryStrings.library.playTrack(play.title, play.artist)}
        accessibilityState={{
          disabled,
          busy,
          selected: presentation.active,
        }}
        disabled={disabled}
        onPress={onPlay}
        style={({ pressed }) => [styles.playControl, pressed && styles.pressed]}
      >
        <Text accessible={false} style={styles.index}>{index + 1}</Text>
        <Artwork play={play} busy={busy} playback={presentation.playback} />
      </Pressable>
      <View style={styles.meta}>
        <TrackIdentityLinks
          metadata={metadata}
          testID={`${testID}-identity`}
          copy={trackIdentityCopy}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
          showPopularity={false}
        />
        <TrackStateIndicator
          presentation={presentation}
          copy={trackStateIndicatorCopy}
          testID={`${testID}-state`}
        />
      </View>
      <Pressable
        testID={`${testID}-actions`}
        accessibilityRole="button"
        accessibilityLabel={`${strings.trackActions.moreActionsLabel}: ${play.title}`}
        onPress={onActions}
        style={({ pressed }) => [styles.actions, pressed && styles.pressed]}
      >
        <AppIcon name="dots-vertical" color={colors.textSecondary} size={25} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: metrics.minimumTouchTarget * 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeRow: { backgroundColor: colors.surface },
  playControl: {
    minWidth: 106,
    minHeight: metrics.minimumTouchTarget * 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 8,
  },
  index: {
    width: 24,
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  artworkFrame: { position: 'relative', width: 50, height: 50 },
  artwork: {
    width: 50,
    height: 50,
    borderRadius: 7,
    backgroundColor: colors.surfaceElevated,
  },
  artworkPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  playBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  meta: { minWidth: 0, flex: 1, paddingHorizontal: 8, paddingVertical: 8 },
  actions: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  actionsGlyph: { color: colors.textSecondary, fontSize: 24, lineHeight: 28 },
  pressed: { opacity: 0.74, backgroundColor: colors.surfacePressed },
});
