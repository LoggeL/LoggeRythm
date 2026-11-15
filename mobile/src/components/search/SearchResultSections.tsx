import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ArtistSummary, PlaylistSearchResult } from '../../api/types';
import type { AlbumCard } from '../../domain/catalog';
import { strings } from '../../localization';
import type {
  SearchAlbumRouteParams,
  SearchArtistRouteParams,
} from '../../screens/searchModel';
import { layout, spacing } from '../../theme';
import { SectionHeader } from '../ui';
import { SearchEntityCard, SearchResultRail } from './SearchResults';

interface SearchResultSectionProps {
  id: string;
  title: string;
  children?: React.ReactNode;
}

/** A titled group of results; `search-section-<id>` is the QA anchor. */
export function SearchResultSection({ id, title, children }: SearchResultSectionProps) {
  return (
    <View testID={`search-section-${id}`} style={styles.section}>
      <SectionHeader title={title} />
      {children}
    </View>
  );
}

interface SearchArtistSectionProps {
  artists: readonly ArtistSummary[];
  onOpenArtist: (params: SearchArtistRouteParams) => void;
}

export function SearchArtistSection({ artists, onOpenArtist }: SearchArtistSectionProps) {
  return (
    <SearchResultSection id="artists" title={strings.search.sections.artists}>
      <SearchResultRail
        id="artists"
        data={artists}
        keyExtractor={(artist, index) => `${artist.id}:${index}`}
        renderItem={(artist) => (
          <SearchEntityCard
            testID={`search-artist-${artist.id}`}
            accessibilityLabel={strings.search.openArtist(artist.name)}
            title={artist.name}
            subtitle={strings.search.tabs.artist}
            imageUri={artist.picture}
            icon="account-music"
            round
            onPress={() => onOpenArtist({ artistId: artist.id, name: artist.name })}
          />
        )}
      />
    </SearchResultSection>
  );
}

interface SearchAlbumSectionProps {
  albums: readonly AlbumCard[];
  onOpenAlbum: (params: SearchAlbumRouteParams) => void;
}

export function SearchAlbumSection({ albums, onOpenAlbum }: SearchAlbumSectionProps) {
  return (
    <SearchResultSection id="albums" title={strings.search.sections.albums}>
      <SearchResultRail
        id="albums"
        data={albums}
        keyExtractor={(album, index) => `${album.id}:${index}`}
        renderItem={(album, index) => (
          <SearchEntityCard
            testID={`search-album-${album.id}-${index}`}
            accessibilityLabel={strings.search.openAlbum(album.title, album.artistName)}
            title={album.title}
            subtitle={album.artistName}
            imageUri={album.artworkUrl}
            icon="album"
            onPress={() => onOpenAlbum({ albumId: album.id, title: album.title })}
          />
        )}
      />
    </SearchResultSection>
  );
}

interface SearchPlaylistSectionProps {
  playlists: readonly PlaylistSearchResult[];
  /** Id of the playlist whose tracks are being resolved for playback. */
  startingPlaylistId: string | null;
  onStartPlaylist: (playlistId: string) => void;
}

export function SearchPlaylistSection({
  playlists,
  startingPlaylistId,
  onStartPlaylist,
}: SearchPlaylistSectionProps) {
  return (
    <SearchResultSection id="playlists" title={strings.search.sections.playlists}>
      <SearchResultRail
        id="playlists"
        data={playlists}
        keyExtractor={(playlist, index) => `${playlist.id}:${index}`}
        renderItem={(playlist) => {
          const busy = startingPlaylistId === playlist.id;
          return (
            <SearchEntityCard
              testID={`search-playlist-${playlist.id}`}
              accessibilityLabel={strings.search.openPlaylist(playlist.title, playlist.track_count)}
              title={playlist.title}
              subtitle={busy
                ? strings.search.playlistLoading
                : strings.common.trackCount(playlist.track_count)}
              imageUri={playlist.cover}
              icon="playlist-music"
              disabled={startingPlaylistId !== null}
              busy={busy}
              onPress={() => onStartPlaylist(playlist.id)}
            />
          );
        }}
      />
    </SearchResultSection>
  );
}

const styles = StyleSheet.create({
  section: { gap: layout.headerGap, paddingTop: spacing.xl },
});
