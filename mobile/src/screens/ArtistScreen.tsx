import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ArtistFooter } from '../components/catalog/ArtistFooter';
import { ArtistHero } from '../components/catalog/ArtistHero';
import { ArtistSongSearchHeader } from '../components/catalog/ArtistSongSearchHeader';
import { ArtistVirtualizedList } from '../components/catalog/ArtistVirtualizedList';
import { CatalogTrackRow } from '../components/catalog/CatalogCards';
import {
  CatalogContentStatus,
  CatalogPageGate,
  CatalogRuntimeError,
  CatalogSection,
} from '../components/catalog/CatalogStates';
import {
  catalogQueryFlags,
  settledCatalogQueryFlags,
} from '../components/catalog/catalogQueryState';
import { showTrackActions } from '../components/trackActions';
import { EmptyState } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries } from '../data';
import { colors, layout } from '../theme';
import {
  artistHasContent,
  artistPopularTracks,
  artistSummary,
  artistTrackPlaybackContextId,
  assertArtistScreenContract,
  requireCatalogId,
  trackContextKey,
  type ArtistScreenContract,
} from './catalogModel';
import { catalogStrings } from './catalogStrings';
import { useArtistFollow } from './useArtistFollow';
import { useArtistSongSearch } from './useArtistSongSearch';
import { useCatalogPlayback } from './useCatalogPlayback';

export type ArtistScreenProps = ArtistScreenContract;
export type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';

export default function ArtistScreen(props: ArtistScreenProps) {
  assertArtistScreenContract(props);
  const artistId = requireCatalogId(props.artistId, 'artist id');
  const { user } = useAuth();
  if (user === null) throw new Error('ArtistScreen requires an authenticated user');

  const scope = musicCacheScope(getCurrentApiBase(), user.id);
  const artist = useQuery(musicQueries.artist(artistId));
  const artistName = artist.data?.name.trim() ?? '';
  const aboutEnabled = artistName.length > 0;
  const about = useQuery({
    ...musicQueries.artistAbout(artistName || '__artist_pending__'),
    enabled: aboutEnabled,
  });
  const { runtimeError, setRuntimeError, play } = useCatalogPlayback();
  const follow = useArtistFollow({
    scope,
    artist:
      artist.data === undefined
        ? { id: artistId, name: '', picture: '' }
        : artistSummary(artist.data),
    onResult: setRuntimeError,
  });
  const songSearch = useArtistSongSearch(artistId, artistName);

  const popularTracks = useMemo(
    () => artistPopularTracks(artist.data?.top ?? []),
    [artist.data?.top],
  );
  const trackPlayRequest = useMemo(
    () => popularTracks.map(({ id, artist: trackArtist, title }) => ({
      id,
      artist: trackArtist,
      title,
    })),
    [popularTracks],
  );
  const hasPopularTracks = trackPlayRequest.length > 0;
  const trackPlays = useQuery({
    ...musicQueries.trackPlayCounts(trackPlayRequest),
    enabled: hasPopularTracks,
  });

  if (artist.data === undefined) {
    return (
      <CatalogPageGate
        id="artist"
        variant="artist"
        hasData={false}
        {...catalogQueryFlags(artist)}
        loadingLabel={catalogStrings.artist.loading}
        onRetry={() => void artist.refetch()}
      />
    );
  }

  const detail = artist.data;
  const playArtist = (tracks: typeof detail.top, index: number, contextId: string) =>
    play(tracks, index, { type: 'artist', id: contextId, label: detail.name });

  const refresh = () => {
    void Promise.allSettled([
      artist.refetch(),
      follow.state.refetch(),
      ...(aboutEnabled ? [about.refetch()] : []),
      ...(hasPopularTracks ? [trackPlays.refetch()] : []),
      ...(songSearch.enabled ? [songSearch.search.refetch()] : []),
    ]);
  };
  const refreshing = [artist, follow.state, about, trackPlays, songSearch.search].some(
    (query) => query.isFetching && !query.isPending,
  );

  return (
    <View testID="artist-screen" style={styles.container}>
      <ArtistVirtualizedList
        artistName={detail.name}
        popularTracks={popularTracks}
        searchTracks={songSearch.results}
        searchActive={songSearch.active}
        refreshing={refreshing}
        refreshAccessibilityLabel={catalogStrings.common.refreshing}
        onRefresh={refresh}
        header={
          <View style={styles.listHeader}>
            <ArtistHero
              artist={detail}
              followState={follow.state}
              following={follow.following}
              followUpdating={follow.updating}
              onToggleFollow={follow.toggle}
              onPlay={() => playArtist(
                detail.top,
                0,
                artistTrackPlaybackContextId(artistId, 'popular'),
              )}
            />
            <CatalogRuntimeError id="artist" message={runtimeError} />
            <CatalogContentStatus
              id="artist"
              hasData
              {...catalogQueryFlags(artist)}
              refreshIndicator={false}
              onRetry={() => void artist.refetch()}
            />
            {!artistHasContent(detail) ? (
              <EmptyState
                testID="artist-empty"
                icon="account-music-outline"
                title={catalogStrings.artist.empty}
              />
            ) : null}
          </View>
        }
        popularHeader={
          <CatalogSection
            id="artist-top-tracks"
            title={catalogStrings.artist.topTracks}
            hasData
            empty={popularTracks.length === 0}
            emptyIcon="music-off"
            {...(hasPopularTracks ? catalogQueryFlags(trackPlays) : settledCatalogQueryFlags)}
            onRetry={() => void trackPlays.refetch()}
            skeleton="rows"
          >
            <View testID="artist-track-list" />
          </CatalogSection>
        }
        searchHeader={
          <ArtistSongSearchHeader
            artistName={detail.name}
            input={songSearch.input}
            onChangeInput={songSearch.setInput}
            query={songSearch.query}
            search={songSearch.search}
            resultCount={songSearch.results.length}
          />
        }
        footer={
          <ArtistFooter
            albums={detail.albums}
            related={detail.related}
            about={about}
            aboutEnabled={aboutEnabled}
            onOpenAlbum={props.onOpenAlbum}
            onOpenArtist={props.onOpenArtist}
          />
        }
        renderTrackItem={({ kind, track, index }) => {
          const isPopular = kind === 'popular';
          const playbackContextId = artistTrackPlaybackContextId(
            artistId,
            isPopular ? 'popular' : 'search',
            songSearch.query,
          );
          return (
            <CatalogTrackRow
              track={track}
              index={index}
              testID={
                isPopular
                  ? `artist-track-${trackContextKey(track, index)}`
                  : `artist-song-search-track-${trackContextKey(track, index)}`
              }
              occurrence={{
                queueContext: { type: 'artist', id: playbackContextId },
                originalContextOrder: index,
              }}
              popularity={isPopular ? 'artist-popular' : 'none'}
              plays={isPopular ? trackPlays.data?.[track.id] : undefined}
              onPress={() => playArtist(
                isPopular ? popularTracks : songSearch.results,
                index,
                playbackContextId,
              )}
              onLongPress={() => showTrackActions(track, setRuntimeError)}
              onOpenAlbum={props.onOpenAlbum}
              onOpenArtist={props.onOpenArtist}
            />
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listHeader: { gap: layout.stackGap },
});
