import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import type {
  AlbumSummary,
  ArtistSummary,
  Genre,
  PlaylistSummary,
  Track,
  TrackPlayCount,
} from '../../api/types';
import { catalogStrings } from '../../screens/catalogStrings';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, layout, radii, spacing } from '../../theme';
import type { AppIconName } from '../AppIcon';
import { ActionButton, AppText, Artwork, PressableScale } from '../ui';
import StandardTrackRow, {
  type TrackOccurrenceTarget,
} from '../track/StandardTrackRow';
import TrackShelfCard from '../track/TrackShelfCard';
import type { TrackPopularityPolicy } from '../track/trackMetadata';

/** Genre tiles are landscape: card width, large-artwork height. */
const GENRE_TILE_HEIGHT = layout.artwork.lg;
/** A playlist card holds a large cover plus one card width of copy. */
const PLAYLIST_CARD_WIDTH = layout.artwork.lg + layout.artwork.card + spacing.xxl;

/**
 * The cover of a detail hero. `compact` is the small variant used next to
 * copy in a row; the default is the full hero size. `round` is for artists.
 */
export function CatalogHeroArtwork({
  uri,
  round = false,
  compact = false,
}: { uri: string; round?: boolean; compact?: boolean }) {
  return (
    <Artwork
      uri={uri}
      size={compact ? layout.artwork.lg : layout.artwork.hero}
      shape={round ? 'round' : 'square'}
      radius="panel"
      icon={round ? 'account-music' : 'music-note'}
    />
  );
}

interface HorizontalCatalogRailProps<T> {
  id: string;
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactElement;
}

/** A full-bleed horizontal shelf on the page gutter. */
export function HorizontalCatalogRail<T>({
  id,
  data,
  keyExtractor,
  renderItem,
}: HorizontalCatalogRailProps<T>) {
  return (
    <FlatList
      testID={`catalog-rail-${id}`}
      horizontal
      data={[...data]}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => renderItem(item, index)}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
    />
  );
}

export function CatalogTrackCard({
  track,
  testID,
  occurrence,
  rank,
  onPress,
  onLongPress,
  onOpenAlbum,
  onOpenArtist,
}: {
  track: Track;
  testID: string;
  occurrence: TrackOccurrenceTarget;
  rank?: number;
  onPress: () => void;
  onLongPress?: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}) {
  return (
    <TrackShelfCard
      track={track}
      testID={testID}
      occurrence={occurrence}
      rank={rank}
      onPlay={onPress}
      onActions={onLongPress}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

export function CatalogAlbumCard({
  album,
  testID,
  onPress,
}: {
  album: AlbumSummary;
  testID: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={catalogStrings.common.openAlbum(album.title, album.artist)}
      onPress={onPress}
      style={styles.tileCard}
    >
      <Artwork uri={album.cover} size={layout.artwork.card} icon="album" />
      <View>
        <AppText variant="bodyStrong" numberOfLines={1}>{album.title}</AppText>
        <AppText variant="callout" color="secondary" numberOfLines={1}>{album.artist}</AppText>
      </View>
    </PressableScale>
  );
}

export function CatalogGenreCard({
  genre,
  testID,
  onPress,
}: {
  genre: Genre;
  testID: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={catalogStrings.common.openGenre(genre.name)}
      onPress={onPress}
      style={styles.genreCard}
    >
      <Artwork
        uri={genre.picture}
        size={layout.artwork.card}
        icon="shape-outline"
        style={styles.genreArtwork}
      />
      <View style={styles.genreOverlay}>
        <AppText variant="section" numberOfLines={2}>{genre.name}</AppText>
      </View>
    </PressableScale>
  );
}

export function CatalogArtistCard({
  artist,
  testID,
  onPress,
}: {
  artist: ArtistSummary;
  testID: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={catalogStrings.common.openArtist(artist.name)}
      onPress={onPress}
      style={styles.tileCard}
    >
      <Artwork
        uri={artist.picture}
        size={layout.artwork.card}
        shape="round"
        icon="account-music"
      />
      <AppText variant="bodyStrong" align="center" numberOfLines={2}>{artist.name}</AppText>
    </PressableScale>
  );
}

export function CatalogPlaylistCard({
  playlist,
  coverUrl,
  testID,
  onPress,
}: {
  playlist: PlaylistSummary;
  coverUrl: string | null;
  testID: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={catalogStrings.discover.openPlaylist(
        playlist.name,
        playlist.owner_name,
        playlist.track_count,
      )}
      onPress={onPress}
      scaleTo={0.98}
      style={styles.playlistCard}
    >
      <Artwork uri={coverUrl} size={layout.artwork.lg} icon="playlist-music" />
      <View style={styles.playlistMeta}>
        <AppText variant="bodyStrong" numberOfLines={2}>{playlist.name}</AppText>
        {playlist.owner_name ? (
          <AppText variant="callout" color="secondary" numberOfLines={1}>
            {catalogStrings.discover.byOwner(playlist.owner_name)}
          </AppText>
        ) : null}
        <AppText variant="caption" color="muted" numberOfLines={1}>
          {catalogStrings.common.tracks(playlist.track_count)}
        </AppText>
      </View>
    </PressableScale>
  );
}

export function CatalogTrackRow({
  track,
  index,
  testID,
  occurrence,
  metadata,
  popularity = 'none',
  plays,
  showAlbumLabel,
  onPress,
  onLongPress,
  onOpenAlbum,
  onOpenArtist,
  highlighted = false,
}: {
  track: Track;
  index: number;
  testID: string;
  occurrence: TrackOccurrenceTarget;
  /** Additional bounded collection fact, such as Radar release recency. */
  metadata?: string;
  popularity?: TrackPopularityPolicy;
  plays?: TrackPlayCount;
  /** false where the album is the page itself. Defaults to the shared row's policy. */
  showAlbumLabel?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
  highlighted?: boolean;
}) {
  return (
    <StandardTrackRow
      track={track}
      testID={testID}
      occurrence={occurrence}
      position={index + 1}
      popularity={popularity}
      plays={plays}
      showAlbumLabel={showAlbumLabel}
      caption={metadata}
      onPlay={onPress}
      onActions={onLongPress}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
      highlighted={highlighted}
    />
  );
}

export function CatalogActionButton({
  testID,
  label,
  accessibilityLabel = label,
  disabled = false,
  secondary = false,
  busy = false,
  icon,
  onPress,
}: {
  testID: string;
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  secondary?: boolean;
  busy?: boolean;
  icon?: AppIconName;
  onPress: () => void;
}) {
  return (
    <ActionButton
      testID={testID}
      label={label}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      busy={busy}
      icon={icon}
      variant={secondary ? 'secondary' : 'primary'}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  rail: { gap: layout.railGap, paddingHorizontal: layout.pagePadding },
  tileCard: { width: layout.artwork.card, gap: spacing.xs },
  genreCard: {
    width: layout.artwork.card,
    height: GENRE_TILE_HEIGHT,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
  genreArtwork: { height: GENRE_TILE_HEIGHT },
  genreOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    padding: spacing.sm,
    backgroundColor: colors.scrim,
  },
  playlistCard: {
    width: PLAYLIST_CARD_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  playlistMeta: { flex: 1, minWidth: 0, gap: spacing.xxs / 2 },
});
