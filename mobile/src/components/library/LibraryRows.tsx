import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ArtistSummary, PlaylistSummary } from '../../api/types';
import { resolveServerUrl } from '../../api/url';
import {
  libraryFollowArtistRoute,
  libraryTestIdSegment,
  type LibraryArtistRouteParams,
  type LibraryPlaylistRouteParams,
} from '../../screens/libraryModel';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, layout, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, Artwork, PressableScale } from '../ui';

const CHEVRON_SIZE = 22;

interface LibraryRowProps {
  testID: string;
  accessibilityLabel: string;
  onPress: () => void;
  artwork: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
}

/**
 * The one navigational row of the Library (playlists, downloads, artists):
 * artwork, a truncating title/subtitle pair and a trailing affordance.
 */
export function LibraryRow({
  testID,
  accessibilityLabel,
  onPress,
  artwork,
  title,
  subtitle,
  trailing,
}: LibraryRowProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      {artwork}
      <View style={styles.copy}>
        <AppText variant="bodyStrong" numberOfLines={1}>{title}</AppText>
        {typeof subtitle === 'string' ? (
          <AppText variant="callout" color="secondary" numberOfLines={1}>{subtitle}</AppText>
        ) : (
          subtitle
        )}
      </View>
      {trailing ?? (
        <AppIcon name="chevron-right" color={colors.textMuted} size={CHEVRON_SIZE} />
      )}
    </Pressable>
  );
}

export interface LibraryPlaylistRowProps {
  playlist: PlaylistSummary;
  apiBase: string;
  onOpenPlaylist: (params: LibraryPlaylistRouteParams) => void;
}

export function LibraryPlaylistRow({ playlist, apiBase, onOpenPlaylist }: LibraryPlaylistRowProps) {
  const description = playlist.description?.trim();
  const count = libraryStrings.common.tracks(playlist.track_count);
  return (
    <LibraryRow
      testID={`library-playlist-${playlist.id}`}
      accessibilityLabel={libraryStrings.library.openPlaylist(playlist.name, playlist.track_count)}
      onPress={() =>
        onOpenPlaylist({ kind: 'playlist', playlistId: playlist.id, name: playlist.name })
      }
      artwork={
        <Artwork
          uri={playlist.cover_url === null ? null : resolveServerUrl(playlist.cover_url, apiBase)}
          size={layout.artwork.md}
          icon="playlist-music"
        />
      }
      title={playlist.name}
      subtitle={description ? `${count} · ${description}` : count}
    />
  );
}

export interface LibraryLikedCollectionCardProps {
  count: number;
  onOpenPlaylist: (params: LibraryPlaylistRouteParams) => void;
}

/** The accent-tinted entry into the complete liked-tracks collection. */
export function LibraryLikedCollectionCard({
  count,
  onOpenPlaylist,
}: LibraryLikedCollectionCardProps) {
  return (
    <PressableScale
      testID="library-open-liked"
      accessibilityRole="button"
      accessibilityLabel={libraryStrings.library.openLiked(count)}
      onPress={() => onOpenPlaylist({ kind: 'liked', name: libraryStrings.library.likedTracks })}
      scaleTo={0.98}
      style={styles.likedCard}
    >
      <View style={styles.likedGlyph}>
        <AppIcon name="heart" color={colors.onAccent} size={26} />
      </View>
      <View style={styles.copy}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {libraryStrings.library.likedTracks}
        </AppText>
        <AppText variant="callout" color="accent" numberOfLines={1}>
          {libraryStrings.common.tracks(count)}
        </AppText>
      </View>
      <AppIcon name="chevron-right" color={colors.accentSoft} size={CHEVRON_SIZE} />
    </PressableScale>
  );
}

export interface LibraryFollowingRowProps {
  artist: ArtistSummary;
  onOpenArtist: (params: LibraryArtistRouteParams) => void;
}

export function LibraryFollowingRow({ artist, onOpenArtist }: LibraryFollowingRowProps) {
  return (
    <LibraryRow
      testID={`library-following-${libraryTestIdSegment(artist.id)}`}
      accessibilityLabel={libraryStrings.library.openArtist(artist.name)}
      onPress={() => onOpenArtist(libraryFollowArtistRoute(artist))}
      artwork={
        <Artwork
          uri={artist.picture || null}
          size={layout.artwork.md}
          shape="round"
          icon="account-music"
        />
      }
      title={artist.name}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: layout.rowHeight + spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.pagePadding,
    paddingVertical: spacing.xs,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs / 2 },
  likedCard: {
    minHeight: layout.rowHeight + spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: layout.pagePadding,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.accentSubtle,
  },
  likedGlyph: {
    width: layout.artwork.md,
    height: layout.artwork.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  pressed: { opacity: opacity.pressed },
});
