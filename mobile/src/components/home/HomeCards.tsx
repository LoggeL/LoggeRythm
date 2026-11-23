import React from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
import type { AlbumSummary, Genre, HomeShelf, Track } from '../../api/types';
import { strings } from '../../localization';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, layout, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import type { TrackOccurrenceTarget } from '../track/StandardTrackRow';
import TrackShelfCard from '../track/TrackShelfCard';
import { AppText, Artwork, PressableScale, type TvFocusProps } from '../ui';

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

export const MemoHomeTrackCard = React.memo(HomeTrackCard);

interface ShelfCardProps extends TvFocusProps {
  shelf: HomeShelf;
  testID: string;
  /** play starts the shelf directly (button); open navigates to its detail (link). */
  action?: 'play' | 'open';
  onPress: () => void;
  /** Optional square card size override for 16:9 Android TV. */
  cardSize?: number;
  titleStyle?: TextStyle;
  subtitleStyle?: TextStyle;
}

/**
 * A mix / collection card. Only directly playable shelves carry the play
 * disc on the cover, so "tap plays" and "tap opens" look different.
 */
export function HomeShelfCard({
  shelf,
  testID,
  action = 'play',
  onPress,
  cardSize = CARD_SIZE,
  titleStyle,
  subtitleStyle,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused,
  focusedStyle,
}: ShelfCardProps) {
  const cover = shelf.cover || shelf.tracks.find((track) => track.cover)?.cover;
  const cardStyle = cardSize === CARD_SIZE ? styles.card : [styles.card, { width: cardSize }];
  return (
    <PressableScale
      testID={testID}
      accessibilityRole={action === 'open' ? 'link' : 'button'}
      accessibilityLabel={
        action === 'open'
          ? strings.home.openShelf(shelf.title, shelf.tracks.length)
          : strings.home.playShelf(shelf.title, shelf.tracks.length)
      }
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={onFocus}
      onBlur={onBlur}
      focused={focused}
      focusedStyle={focusedStyle}
      onPress={onPress}
      style={cardStyle}
    >
      <View>
        <Artwork uri={cover} size={cardSize} icon="playlist-music" />
        {action === 'play' ? (
          <View testID={`${testID}-play`} accessible={false} style={styles.playDisc}>
            <AppIcon name="play" color={colors.textPrimary} size={22} />
          </View>
        ) : null}
      </View>
      <View style={styles.copy}>
        <AppText variant="bodyStrong" numberOfLines={2} style={titleStyle}>{shelf.title}</AppText>
        <AppText variant="callout" color="secondary" numberOfLines={1} style={subtitleStyle}>
          {shelf.subtitle || strings.common.trackCount(shelf.tracks.length)}
        </AppText>
      </View>
    </PressableScale>
  );
}

export const MemoHomeShelfCard = React.memo(HomeShelfCard);

interface AlbumCardProps extends TvFocusProps {
  album: AlbumSummary;
  testID: string;
  onPress: () => void;
  cardSize?: number;
  titleStyle?: TextStyle;
  subtitleStyle?: TextStyle;
}

export function HomeAlbumCard({
  album,
  testID,
  onPress,
  cardSize = CARD_SIZE,
  titleStyle,
  subtitleStyle,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused,
  focusedStyle,
}: AlbumCardProps) {
  const cardStyle = cardSize === CARD_SIZE ? styles.card : [styles.card, { width: cardSize }];
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={strings.home.openAlbum(album.title, album.artist)}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={onFocus}
      onBlur={onBlur}
      focused={focused}
      focusedStyle={focusedStyle}
      onPress={onPress}
      style={cardStyle}
    >
      <Artwork uri={album.cover} size={cardSize} icon="album" />
      <View style={styles.copy}>
        <AppText variant="bodyStrong" numberOfLines={1} style={titleStyle}>{album.title}</AppText>
        <AppText variant="callout" color="secondary" numberOfLines={1} style={subtitleStyle}>
          {strings.home.albumBy(album.artist)}
        </AppText>
      </View>
    </PressableScale>
  );
}

export const MemoHomeAlbumCard = React.memo(HomeAlbumCard);

interface GenreCardProps extends TvFocusProps {
  genre: Genre;
  testID: string;
  onPress: () => void;
  cardWidth?: number;
  cardHeight?: number;
  titleStyle?: TextStyle;
}

export function HomeGenreCard({
  genre,
  testID,
  onPress,
  cardWidth = GENRE_WIDTH,
  cardHeight = GENRE_HEIGHT,
  titleStyle,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused,
  focusedStyle,
}: GenreCardProps) {
  const cardStyle =
    cardWidth === GENRE_WIDTH && cardHeight === GENRE_HEIGHT
      ? styles.genreCard
      : [styles.genreCard, { width: cardWidth, height: cardHeight }];
  const artworkStyle =
    cardHeight === GENRE_HEIGHT
      ? styles.genreArtwork
      : [styles.genreArtwork, { height: cardHeight }];
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={strings.home.openGenre(genre.name)}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={onFocus}
      onBlur={onBlur}
      focused={focused}
      focusedStyle={focusedStyle}
      onPress={onPress}
      style={cardStyle}
    >
      <Artwork uri={genre.picture} size={cardWidth} style={artworkStyle} />
      <View style={styles.genreLabel}>
        <AppText variant="bodyStrong" numberOfLines={1} style={titleStyle}>{genre.name}</AppText>
      </View>
    </PressableScale>
  );
}

export const MemoHomeGenreCard = React.memo(HomeGenreCard);

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
