import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { AlbumSummary, Genre, HomeShelf, Track } from '../../api/types';
import { strings } from '../../localization';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, layout, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import type { TrackOccurrenceTarget } from '../track/StandardTrackRow';
import TrackShelfCard from '../track/TrackShelfCard';
import { AppText, Artwork, PressableScale } from '../ui';

const CARD_SIZE = layout.artwork.card;
const GENRE_WIDTH = layout.artwork.card;
const GENRE_HEIGHT = layout.artwork.lg;
const PLAY_DISC = spacing.xxxl;

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

interface ShelfCardProps {
  shelf: HomeShelf;
  testID: string;
  /** play starts the shelf directly (button); open navigates to its detail (link). */
  action?: 'play' | 'open';
  onPress: () => void;
}

/**
 * A mix / collection card. Only directly playable shelves carry the play
 * disc on the cover, so "tap plays" and "tap opens" look different.
 */
export function HomeShelfCard({ shelf, testID, action = 'play', onPress }: ShelfCardProps) {
  const cover = shelf.cover || shelf.tracks.find((track) => track.cover)?.cover;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole={action === 'open' ? 'link' : 'button'}
      accessibilityLabel={
        action === 'open'
          ? strings.home.openShelf(shelf.title, shelf.tracks.length)
          : strings.home.playShelf(shelf.title, shelf.tracks.length)
      }
      onPress={onPress}
      style={styles.card}
    >
      <View>
        <Artwork uri={cover} size={CARD_SIZE} icon="playlist-music" />
        {action === 'play' ? (
          <View testID={`${testID}-play`} accessible={false} style={styles.playDisc}>
            <AppIcon name="play" color={colors.textPrimary} size={22} />
          </View>
        ) : null}
      </View>
      <View style={styles.copy}>
        <AppText variant="bodyStrong" numberOfLines={2}>{shelf.title}</AppText>
        <AppText variant="callout" color="secondary" numberOfLines={1}>
          {shelf.subtitle || strings.common.trackCount(shelf.tracks.length)}
        </AppText>
      </View>
    </PressableScale>
  );
}

interface AlbumCardProps {
  album: AlbumSummary;
  testID: string;
  onPress: () => void;
}

export function HomeAlbumCard({ album, testID, onPress }: AlbumCardProps) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={strings.home.openAlbum(album.title, album.artist)}
      onPress={onPress}
      style={styles.card}
    >
      <Artwork uri={album.cover} size={CARD_SIZE} icon="album" />
      <View style={styles.copy}>
        <AppText variant="bodyStrong" numberOfLines={1}>{album.title}</AppText>
        <AppText variant="callout" color="secondary" numberOfLines={1}>
          {strings.home.albumBy(album.artist)}
        </AppText>
      </View>
    </PressableScale>
  );
}

interface GenreCardProps {
  genre: Genre;
  testID: string;
  onPress: () => void;
}

export function HomeGenreCard({ genre, testID, onPress }: GenreCardProps) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={strings.home.openGenre(genre.name)}
      onPress={onPress}
      style={styles.genreCard}
    >
      <Artwork uri={genre.picture} size={GENRE_WIDTH} style={styles.genreArtwork} />
      <View style={styles.genreLabel}>
        <AppText variant="bodyStrong" numberOfLines={1}>{genre.name}</AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { width: CARD_SIZE, gap: spacing.xs },
  copy: { minWidth: 0 },
  playDisc: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    width: PLAY_DISC,
    height: PLAY_DISC,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
  genreCard: {
    width: GENRE_WIDTH,
    height: GENRE_HEIGHT,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
  },
  genreArtwork: { position: 'absolute', top: 0, left: 0, height: GENRE_HEIGHT, borderRadius: 0 },
  genreLabel: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.scrim,
  },
});
