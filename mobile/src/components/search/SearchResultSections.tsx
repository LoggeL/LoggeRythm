import React from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
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
  paddingHorizontal?: number;
  children?: React.ReactNode;
}

interface SearchSectionTvProps {
  cardSize?: number;
  paddingHorizontal?: number;
  gap?: number;
  titleStyle?: TextStyle;
  subtitleStyle?: TextStyle;
  onCardFocus?: (focusKey: string) => void;
}

/** A titled group of results; `search-section-<id>` is the QA anchor. */
export function SearchResultSection({
  id,
  title,
  paddingHorizontal,
  children,
}: SearchResultSectionProps) {
  return (
    <View testID={`search-section-${id}`} style={styles.section}>
      <SectionHeader
        title={title}
        style={paddingHorizontal === undefined ? undefined : { paddingHorizontal }}
      />
      {children}
    </View>
  );
}

interface SearchArtistSectionProps extends SearchSectionTvProps {
  artists: readonly ArtistSummary[];
  onOpenArtist: (params: SearchArtistRouteParams) => void;
}

export function SearchArtistSection({
  artists,
  onOpenArtist,
  cardSize,
  paddingHorizontal,
  gap,
  titleStyle,
  subtitleStyle,
  onCardFocus,
}: SearchArtistSectionProps) {
  return (
    <SearchResultSection
      id="artists"
      title={strings.search.sections.artists}
      paddingHorizontal={paddingHorizontal}
    >
      <SearchResultRail
        id="artists"
        data={artists}
        paddingHorizontal={paddingHorizontal}
        gap={gap}
        keyExtractor={(artist, index) => `${artist.id}:${index}`}
        renderItem={(artist) => {
          const cardTestId = `search-artist-${artist.id}`;
          return (
            <SearchEntityCard
              testID={cardTestId}
              accessibilityLabel={strings.search.openArtist(artist.name)}
              title={artist.name}
              subtitle={strings.search.tabs.artist}
              imageUri={artist.picture}
              icon="account-music"
              round
              cardSize={cardSize}
              titleStyle={titleStyle}
              subtitleStyle={subtitleStyle}
              onFocus={onCardFocus ? () => onCardFocus(cardTestId) : undefined}
              onPress={() => onOpenArtist({ artistId: artist.id, name: artist.name })}
            />
          );
        }}
      />
    </SearchResultSection>
  );
}

interface SearchAlbumSectionProps extends SearchSectionTvProps {
  albums: readonly AlbumCard[];
  onOpenAlbum: (params: SearchAlbumRouteParams) => void;
}

export function SearchAlbumSection({
  albums,
  onOpenAlbum,
  cardSize,
  paddingHorizontal,
  gap,
  titleStyle,
  subtitleStyle,
  onCardFocus,
}: SearchAlbumSectionProps) {
  return (
    <SearchResultSection
      id="albums"
      title={strings.search.sections.albums}
      paddingHorizontal={paddingHorizontal}
    >
      <SearchResultRail
        id="albums"
        data={albums}
        paddingHorizontal={paddingHorizontal}
        gap={gap}
        keyExtractor={(album, index) => `${album.id}:${index}`}
        renderItem={(album, index) => {
          const cardTestId = `search-album-${album.id}-${index}`;
          return (
            <SearchEntityCard
              testID={cardTestId}
              accessibilityLabel={strings.search.openAlbum(album.title, album.artistName)}
              title={album.title}
              subtitle={album.artistName}
              imageUri={album.artworkUrl}
              icon="album"
              cardSize={cardSize}
              titleStyle={titleStyle}
              subtitleStyle={subtitleStyle}
              onFocus={onCardFocus ? () => onCardFocus(cardTestId) : undefined}
              onPress={() => onOpenAlbum({ albumId: album.id, title: album.title })}
            />
          );
        }}
      />
    </SearchResultSection>
  );
}

interface SearchPlaylistSectionProps extends SearchSectionTvProps {
  playlists: readonly PlaylistSearchResult[];
  /** Id of the playlist whose tracks are being resolved for playback. */
  startingPlaylistId: string | null;
  onStartPlaylist: (playlistId: string) => void;
}

export function SearchPlaylistSection({
  playlists,
  startingPlaylistId,
  onStartPlaylist,
  cardSize,
  paddingHorizontal,
  gap,
  titleStyle,
  subtitleStyle,
  onCardFocus,
}: SearchPlaylistSectionProps) {
  return (
    <SearchResultSection
      id="playlists"
      title={strings.search.sections.playlists}
      paddingHorizontal={paddingHorizontal}
    >
      <SearchResultRail
        id="playlists"
        data={playlists}
        paddingHorizontal={paddingHorizontal}
        gap={gap}
        keyExtractor={(playlist, index) => `${playlist.id}:${index}`}
        renderItem={(playlist) => {
          const busy = startingPlaylistId === playlist.id;
          const cardTestId = `search-playlist-${playlist.id}`;
          return (
            <SearchEntityCard
              testID={cardTestId}
              accessibilityLabel={strings.search.openPlaylist(playlist.title, playlist.track_count)}
              title={playlist.title}
              subtitle={busy
                ? strings.search.playlistLoading
                : strings.common.trackCount(playlist.track_count)}
              imageUri={playlist.cover}
              icon="playlist-music"
              disabled={startingPlaylistId !== null}
              busy={busy}
              cardSize={cardSize}
              titleStyle={titleStyle}
              subtitleStyle={subtitleStyle}
              onFocus={onCardFocus ? () => onCardFocus(cardTestId) : undefined}
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
