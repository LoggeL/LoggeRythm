import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { colors, metrics } from '../../theme';
import AppIcon from '../AppIcon';
import StandardTrackRow, {
  type TrackOccurrenceTarget,
} from '../track/StandardTrackRow';
import TrackShelfCard from '../track/TrackShelfCard';
import type { TrackPopularityPolicy } from '../track/trackMetadata';

function Artwork({ uri, style }: { uri: string | null; style: object }) {
  return uri ? (
    <Image accessible={false} source={{ uri }} style={style} />
  ) : (
    <View style={[style, styles.placeholder]}>
      <AppIcon name="music-note" color={colors.accentSoft} size={22} />
    </View>
  );
}

export function CatalogHeroArtwork({ uri, round = false }: { uri: string; round?: boolean }) {
  return (
    <Artwork
      uri={uri || null}
      style={[styles.heroArtwork, round && styles.heroArtworkRound]}
    />
  );
}

interface HorizontalCatalogRailProps<T> {
  id: string;
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactElement;
}

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
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={catalogStrings.common.openAlbum(album.title, album.artist)}
      onPress={onPress}
      style={({ pressed }) => [styles.albumCard, pressed && styles.pressed]}
    >
      <Artwork uri={album.cover || null} style={styles.squareArtwork} />
      <Text style={styles.cardTitle} numberOfLines={1}>{album.title}</Text>
      <Text style={styles.cardSubtitle} numberOfLines={1}>{album.artist}</Text>
    </Pressable>
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
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={catalogStrings.common.openGenre(genre.name)}
      onPress={onPress}
      style={({ pressed }) => [styles.genreCard, pressed && styles.pressed]}
    >
      <Artwork uri={genre.picture || null} style={styles.genreArtwork} />
      <View style={styles.genreOverlay}>
        <Text style={styles.genreTitle} numberOfLines={2}>{genre.name}</Text>
      </View>
    </Pressable>
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
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={catalogStrings.common.openArtist(artist.name)}
      onPress={onPress}
      style={({ pressed }) => [styles.artistCard, pressed && styles.pressed]}
    >
      <Artwork uri={artist.picture || null} style={styles.artistArtwork} />
      <Text style={styles.artistTitle} numberOfLines={2}>{artist.name}</Text>
    </Pressable>
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
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={catalogStrings.discover.openPlaylist(
        playlist.name,
        playlist.owner_name,
        playlist.track_count,
      )}
      onPress={onPress}
      style={({ pressed }) => [styles.playlistCard, pressed && styles.pressed]}
    >
      <Artwork uri={coverUrl} style={styles.playlistArtwork} />
      <View style={styles.playlistMeta}>
        <Text style={styles.cardTitle} numberOfLines={2}>{playlist.name}</Text>
        {playlist.owner_name ? (
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {catalogStrings.discover.byOwner(playlist.owner_name)}
          </Text>
        ) : null}
        <Text style={styles.cardSubtitle}>{catalogStrings.common.tracks(playlist.track_count)}</Text>
      </View>
    </Pressable>
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
  onPress,
  onLongPress,
  onOpenAlbum,
  onOpenArtist,
}: {
  track: Track;
  index: number;
  testID: string;
  occurrence: TrackOccurrenceTarget;
  /** Additional bounded collection fact, such as Radar release recency. */
  metadata?: string;
  popularity?: TrackPopularityPolicy;
  plays?: TrackPlayCount;
  onPress: () => void;
  onLongPress?: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}) {
  return (
    <View>
      <StandardTrackRow
        track={track}
        testID={testID}
        occurrence={occurrence}
        position={index + 1}
        popularity={popularity}
        plays={plays}
        onPlay={onPress}
        onActions={onLongPress}
        onOpenAlbum={onOpenAlbum}
        onOpenArtist={onOpenArtist}
      />
      {metadata === undefined ? null : (
        <Text
          testID={`${testID}-metadata`}
          accessibilityLabel={metadata}
          style={styles.rowSupplementalMetadata}
          numberOfLines={2}
        >
          {metadata}
        </Text>
      )}
    </View>
  );
}

export function CatalogActionButton({
  testID,
  label,
  accessibilityLabel = label,
  disabled = false,
  secondary = false,
  onPress,
}: {
  testID: string;
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  secondary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        secondary && styles.actionSecondary,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.actionText, secondary && styles.actionSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { gap: 12, paddingHorizontal: 16 },
  albumCard: { width: 152, minHeight: 214, gap: 5 },
  squareArtwork: {
    width: 152,
    height: 152,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
  },
  heroArtwork: {
    width: 196,
    height: 196,
    borderRadius: 18,
    backgroundColor: colors.surfaceElevated,
  },
  heroArtworkRound: { borderRadius: 98 },
  cardTitle: { color: colors.textPrimary, fontSize: 15, lineHeight: 19, fontWeight: '700' },
  cardSubtitle: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  genreCard: {
    width: 180,
    height: 128,
    minHeight: metrics.minimumTouchTarget,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  genreArtwork: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  genreOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    padding: 12,
    backgroundColor: 'rgba(10,10,20,0.38)',
  },
  genreTitle: { color: colors.textPrimary, fontSize: 18, lineHeight: 22, fontWeight: '900' },
  artistCard: { width: 132, minHeight: 180, alignItems: 'center', gap: 8 },
  artistArtwork: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.surfaceElevated,
  },
  artistTitle: { color: colors.textPrimary, fontSize: 14, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  playlistCard: {
    width: 252,
    minHeight: 136,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  playlistArtwork: { width: 104, height: 104, borderRadius: 10, backgroundColor: colors.surface },
  playlistMeta: { flex: 1, minWidth: 0, gap: 4 },
  rowSupplementalMetadata: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  action: {
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    borderRadius: 24,
    backgroundColor: colors.accent,
  },
  actionSecondary: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  actionSecondaryText: { color: colors.textPrimary },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  glyph: { color: colors.accentSoft, fontSize: 28 },
  pressed: { opacity: 0.74, backgroundColor: colors.surfacePressed },
  disabled: { opacity: 0.5 },
});
