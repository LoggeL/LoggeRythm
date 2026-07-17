import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AlbumSummary, Genre, HomeShelf, Track } from '../../api/types';
import type { RecentPlay } from '../../domain/listeningStats';
import { strings } from '../../localization';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, metrics } from '../../theme';
import TrackStateIndicator from '../TrackStateIndicator';
import AppIcon from '../AppIcon';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import type { TrackOccurrenceTarget } from '../track/StandardTrackRow';
import TrackIdentityLinks from '../track/TrackIdentityLinks';
import TrackShelfCard from '../track/TrackShelfCard';
import { buildTrackMetadata } from '../track/trackMetadata';
import {
  trackIdentityCopy,
  trackStateIndicatorCopy,
} from '../track/trackPresentationCopy';

interface TrackCardProps {
  track: Track;
  testID: string;
  occurrence: TrackOccurrenceTarget;
  onPress: () => void;
  onLongPress?: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

export function HomeTrackCard({
  track,
  testID,
  occurrence,
  onPress,
  onLongPress,
  onOpenAlbum,
  onOpenArtist,
}: TrackCardProps) {
  return (
    <TrackShelfCard
      track={track}
      testID={testID}
      occurrence={occurrence}
      onPlay={onPress}
      onActions={onLongPress}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

interface RecentCardProps {
  play: RecentPlay;
  testID: string;
  occurrence: TrackOccurrenceTarget;
  busy: boolean;
  disabled: boolean;
  onPlay: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

/** A history card keeps playback, album, and artist navigation as distinct controls. */
export function HomeRecentCard({
  play,
  testID,
  occurrence,
  busy,
  disabled,
  onPlay,
  onOpenAlbum,
  onOpenArtist,
}: RecentCardProps) {
  const presentation = useTrackPresentation({ trackId: play.id, ...occurrence });
  const buffering = presentation.playback === 'buffering';
  return (
    <View style={[styles.recentCard, presentation.active && styles.activeTrackCard]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={strings.home.playTrack(play.title, play.artist)}
        accessibilityState={{
          disabled,
          busy: busy || buffering,
          selected: presentation.active,
        }}
        disabled={disabled}
        onPress={onPlay}
        style={({ pressed }) => [styles.recentPlay, pressed && styles.pressed]}
      >
        {play.cover ? (
          <Image accessible={false} source={{ uri: play.cover }} style={styles.squareArtwork} />
        ) : (
          <View style={[styles.squareArtwork, styles.placeholder]}>
            <AppIcon name="music-note" color={colors.accentSoft} size={29} />
          </View>
        )}
        <View accessible={false} style={styles.recentPlayBadge}>
          {busy || buffering ? (
            <ActivityIndicator color={colors.onAccent} size="small" />
          ) : (
            <AppIcon
              name={presentation.playback === 'playing' ? 'pause' : 'play'}
              color={colors.onAccent}
              size={22}
            />
          )}
        </View>
      </Pressable>
      <View style={styles.recentIdentity}>
        <TrackIdentityLinks
          metadata={buildTrackMetadata(play)}
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
    </View>
  );
}

interface ShelfCardProps {
  shelf: HomeShelf;
  testID: string;
  action?: 'play' | 'open';
  highlighted?: boolean;
  statusBadge?: string;
  onPress: () => void;
}

export function HomeShelfCard({
  shelf,
  testID,
  action = 'play',
  highlighted = false,
  statusBadge,
  onPress,
}: ShelfCardProps) {
  const cover = shelf.cover || shelf.tracks.find((track) => track.cover)?.cover || '';
  const actionLabel =
    action === 'open'
      ? strings.home.openShelf(shelf.title, shelf.tracks.length)
      : strings.home.playShelf(shelf.title, shelf.tracks.length);
  return (
    <Pressable
      testID={testID}
      accessibilityRole={action === 'open' ? 'link' : 'button'}
      accessibilityLabel={statusBadge ? `${actionLabel}. ${statusBadge}` : actionLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.shelfCard,
        highlighted && styles.shelfCardHighlighted,
        pressed && styles.pressed,
      ]}
    >
      {cover ? (
        <Image accessible={false} source={{ uri: cover }} style={styles.shelfArtwork} />
      ) : (
        <View style={[styles.shelfArtwork, styles.placeholder]}>
          <AppIcon name="music-note" color={colors.accentSoft} size={29} />
        </View>
      )}
      <View style={styles.shelfMeta}>
        {statusBadge ? (
          <Text testID={`${testID}-status`} style={styles.statusBadge}>{statusBadge}</Text>
        ) : null}
        <Text style={styles.title} numberOfLines={2}>{shelf.title}</Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {shelf.subtitle || strings.common.trackCount(shelf.tracks.length)}
        </Text>
      </View>
    </Pressable>
  );
}

interface AlbumCardProps {
  album: AlbumSummary;
  testID: string;
  onPress: () => void;
}

export function HomeAlbumCard({ album, testID, onPress }: AlbumCardProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={strings.home.openAlbum(album.title, album.artist)}
      onPress={onPress}
      style={({ pressed }) => [styles.trackCard, pressed && styles.pressed]}
    >
      {album.cover ? (
        <Image accessible={false} source={{ uri: album.cover }} style={styles.squareArtwork} />
      ) : (
        <View style={[styles.squareArtwork, styles.placeholder]}>
          <AppIcon name="music-note" color={colors.accentSoft} size={29} />
        </View>
      )}
      <Text style={styles.title} numberOfLines={1}>{album.title}</Text>
      <Text style={styles.subtitle} numberOfLines={1}>{strings.home.albumBy(album.artist)}</Text>
    </Pressable>
  );
}

interface GenreCardProps {
  genre: Genre;
  testID: string;
  onPress: () => void;
}

export function HomeGenreCard({ genre, testID, onPress }: GenreCardProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={strings.home.openGenre(genre.name)}
      onPress={onPress}
      style={({ pressed }) => [styles.genreCard, pressed && styles.pressed]}
    >
      {genre.picture ? (
        <Image accessible={false} source={{ uri: genre.picture }} style={styles.genreArtwork} />
      ) : (
        <View style={[styles.genreArtwork, styles.placeholder]}>
          <AppIcon name="music-note" color={colors.accentSoft} size={29} />
        </View>
      )}
      <View style={styles.genreOverlay}>
        <Text style={styles.genreTitle} numberOfLines={2}>{genre.name}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trackCard: { width: 152, minHeight: 210 },
  recentCard: { width: 152, minHeight: 220 },
  activeTrackCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  recentIdentity: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 5,
  },
  recentPlay: { position: 'relative' },
  recentPlayBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: metrics.minimumTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  shelfCard: {
    width: 248,
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  shelfCardHighlighted: { borderColor: colors.accent, borderWidth: 2 },
  statusBadge: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    color: colors.onAccent,
    backgroundColor: colors.accent,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
  },
  pressed: { opacity: 0.76, backgroundColor: colors.surfacePressed },
  squareArtwork: { width: 152, height: 152, borderRadius: 12, backgroundColor: colors.surfaceElevated },
  shelfArtwork: { width: 96, height: 96, borderRadius: 10, backgroundColor: colors.surface },
  placeholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  shelfMeta: { flex: 1, minWidth: 0, gap: 5 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  genreCard: {
    width: 180,
    height: 128,
    minHeight: metrics.minimumTouchTarget,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  genreArtwork: { position: 'absolute', inset: 0 },
  genreOverlay: {
    position: 'absolute',
    inset: 0,
    justifyContent: 'flex-end',
    padding: 12,
    backgroundColor: 'rgba(10,10,20,0.32)',
  },
  genreTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
});
