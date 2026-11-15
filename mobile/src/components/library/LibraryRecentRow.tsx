import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { RecentPlay } from '../../domain/listeningStats';
import { strings } from '../../localization';
import type { TrackOccurrenceIdentity } from '../../player/trackPresentation';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import TrackStateIndicator from '../TrackStateIndicator';
import AppIcon from '../AppIcon';
import TrackIdentityLinks from '../track/TrackIdentityLinks';
import { buildTrackMetadata } from '../track/trackMetadata';
import {
  trackIdentityCopy,
  trackStateIndicatorCopy,
} from '../track/trackPresentationCopy';
import { AppText, Artwork, IconButton } from '../ui';

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

const PLAY_BADGE_SIZE = 24;

function RecentArtwork({
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
      <Artwork uri={play.cover} size={layout.artwork.sm} />
      <View accessible={false} style={styles.playBadge}>
        {buffering ? (
          <ActivityIndicator color={colors.onAccent} size="small" />
        ) : (
          <AppIcon
            name={playback === 'playing' ? 'pause' : 'play'}
            color={colors.onAccent}
            size={14}
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
      style={[styles.row, presentation.active ? styles.activeRow : null]}
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
        style={({ pressed }) => [styles.playControl, pressed ? styles.pressed : null]}
      >
        <AppText
          accessible={false}
          variant="caption"
          color={presentation.active ? 'accent' : 'muted'}
          align="center"
          style={styles.index}
        >
          {index + 1}
        </AppText>
        <RecentArtwork play={play} busy={busy} playback={presentation.playback} />
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
      <IconButton
        testID={`${testID}-actions`}
        icon="dots-vertical"
        accessibilityLabel={`${strings.trackActions.moreActionsLabel}: ${play.title}`}
        onPress={onActions}
        style={styles.actions}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: layout.rowHeight + spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeRow: { backgroundColor: colors.accentSubtle },
  playControl: {
    minWidth: metrics.minimumTouchTarget * 2,
    minHeight: layout.rowHeight + spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: layout.pagePadding - spacing.xs,
    paddingRight: spacing.xs,
  },
  index: { width: spacing.xl },
  artworkFrame: { width: layout.artwork.sm, height: layout.artwork.sm },
  playBadge: {
    position: 'absolute',
    right: -spacing.xxs,
    bottom: -spacing.xxs,
    width: PLAY_BADGE_SIZE,
    height: PLAY_BADGE_SIZE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  meta: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.xs,
  },
  actions: { marginRight: spacing.xs },
  pressed: { opacity: opacity.pressed },
});
