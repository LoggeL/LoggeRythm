import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArtistDetail, Track } from '../api/types';
import { ArtistFooter } from '../components/catalog/ArtistFooter';
import { ArtistHero } from '../components/catalog/ArtistHero';
import { ArtistLikedTracksHeader } from '../components/catalog/ArtistLikedTracksHeader';
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
import { EmptyState, TrackRowSkeleton } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { getCurrentApiBase } from '../config';
import { findCachedArtistSummary, musicCacheScope, musicQueries, musicRepository } from '../data';
import { resolveRemoteVisualState } from '../data/remoteState';
import { useBottomInset } from '../hooks/useBottomInset';
import { playTracks } from '../player/controller';
import { shareArtist } from '../share/outboundShare';
import { colors, layout, spacing } from '../theme';
import { TvFocusScope, useTvEnvironment, useTvFocusReturn } from '../tv';
import { artistLikedSectionVisible } from './artistTrackListModel';
import {
  artistHasContent,
  artistLikedTracks,
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

const EMPTY_TRACKS: readonly Track[] = [];

export default function ArtistScreen(props: ArtistScreenProps) {
  assertArtistScreenContract(props);
  const artistId = requireCatalogId(props.artistId, 'artist id');
  const { user } = useAuth();
  if (user === null) throw new Error('ArtistScreen requires an authenticated user');

  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const bottomInset = useBottomInset();
  const tv = useTvEnvironment();
  useTvFocusReturn({ scope: 'artist', active: isFocused, enabled: tv.isTv });
  const scope = musicCacheScope(getCurrentApiBase(), user.id);
  const artist = useQuery(musicQueries.artist(artistId));
  const seededArtist = useMemo(
    () => findCachedArtistSummary(queryClient, artistId, scope),
    [artistId, queryClient, scope],
  );
  const routeName = props.name?.trim() ?? '';
  const artistName = artist.data?.name.trim() ?? '';
  const aboutEnabled = artistName.length > 0;
  const about = useQuery({
    ...musicQueries.artistAbout(artistName || '__artist_pending__'),
    enabled: aboutEnabled,
  });
  const { runtimeError, setRuntimeError, play, playRow, shuffle } = useCatalogPlayback();
  const follow = useArtistFollow({
    scope,
    artist:
      artist.data === undefined
        ? {
            id: artistId,
            name: seededArtist?.name ?? routeName,
            picture: seededArtist?.picture ?? '',
          }
        : artistSummary(artist.data),
    onResult: setRuntimeError,
  });
  const songSearch = useArtistSongSearch(scope, artistId, artistName);
  // The account's likes cache is what every heart control updates optimistically,
  // so the liked block follows a like/unlike made anywhere in the app at once.
  const likes = useQuery(musicQueries.likes(scope));
  const [likedExpanded, setLikedExpanded] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [busyTag, setBusyTag] = useState<string | null>(null);
  const artistLoadedName = artist.data?.name;
  const likedTracks = useMemo(
    // The name is needed for likes saved before performer ids were stored;
    // until the artist has loaded, the page shows its gate, not this block.
    () => (likes.data === undefined || artistLoadedName === undefined
      ? []
      : artistLikedTracks(likes.data, artistId, artistLoadedName)),
    [likes.data, artistId, artistLoadedName],
  );

  const popularTracks = useMemo(
    () => artistPopularTracks(artist.data?.top ?? EMPTY_TRACKS),
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

  const likedSectionVisible = artistLikedSectionVisible(
    { hasData: likes.data !== undefined, ...catalogQueryFlags(likes) },
    likedTracks.length,
  );
  const likedCollection = useMemo(
    () => (likedSectionVisible ? { tracks: likedTracks, expanded: likedExpanded } : null),
    [likedExpanded, likedSectionVisible, likedTracks],
  );

  const refresh = useCallback(() => {
    setManualRefreshing(true);
    void Promise.allSettled([
      artist.refetch(),
      follow.state.refetch(),
      likes.refetch(),
      ...(aboutEnabled ? [about.refetch()] : []),
      ...(hasPopularTracks ? [trackPlays.refetch()] : []),
      ...(songSearch.enabled ? [songSearch.search.refetch()] : []),
    ]).finally(() => setManualRefreshing(false));
  }, [
    about,
    aboutEnabled,
    artist,
    follow.state,
    hasPopularTracks,
    likes,
    songSearch.enabled,
    songSearch.search,
    trackPlays,
  ]);

  const startTagRadio = useCallback(async (tag: string) => {
    const normalized = tag.trim();
    if (normalized.length === 0 || busyTag !== null) return;
    setBusyTag(normalized);
    setRuntimeError(null);
    try {
      const tracks = await musicRepository.getMood(normalized);
      if (tracks.length === 0) {
        setRuntimeError(catalogStrings.artist.tagRadioEmpty(normalized));
        return;
      }
      await playTracks(tracks, 0, {
        radio: true,
        context: {
          type: 'radio',
          id: `mood:${normalized.toLocaleLowerCase('en-US')}`,
          label: `${normalized} Radio`,
        },
      });
    } catch {
      setRuntimeError(catalogStrings.artist.tagRadioFailed(normalized));
    } finally {
      setBusyTag(null);
    }
  }, [busyTag, setRuntimeError]);

  const initialVisual = resolveRemoteVisualState({
    hasData: artist.data !== undefined,
    empty: false,
    pending: artist.isPending,
    fetching: artist.isFetching,
    stale: artist.isStale,
    fetchStatus: artist.fetchStatus,
    error: artist.error,
  });
  const seededInitialLoading =
    artist.data === undefined
    && initialVisual.body === 'loading'
    && (seededArtist !== null || routeName.length > 0);

  if (artist.data === undefined && !seededInitialLoading) {
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

  if (seededInitialLoading) {
    const seededDetail: ArtistDetail = {
      id: artistId,
      name: seededArtist?.name ?? routeName,
      picture: seededArtist?.picture ?? '',
      fans: 0,
      albums_count: 0,
      top: [],
      albums: [],
      related: [],
    };
    return (
      <TvFocusScope scope="artist">
        <View
          testID="artist-screen"
          style={[
            styles.container,
            tv.isTv ? [styles.tvSplit, { gap: tv.gridGap }] : styles.seededLoading,
          ]}
        >
          <View
            style={
              tv.isTv
                ? { width: Math.round(tv.contentWidth * tv.splitPrimaryRatio) }
                : undefined
            }
          >
            <ArtistHero
              artist={seededDetail}
              followState={follow.state}
              following={follow.following}
              followUpdating={follow.updating}
              onToggleFollow={follow.toggle}
              onPlay={() => undefined}
              onShuffle={() => undefined}
            />
          </View>
          <View style={tv.isTv ? styles.tvTracksPane : undefined}>
            <TrackRowSkeleton
              testID="artist-loading"
              accessibilityLabel={catalogStrings.artist.loading}
              count={5}
            />
          </View>
        </View>
      </TvFocusScope>
    );
  }

  const detail = artist.data;
  if (detail === undefined) {
    throw new Error(`ArtistScreen reached loaded render without detail for artist ${String(artistId)}`);
  }
  const playArtistAll = () =>
    play(detail.top, 0, {
      type: 'artist',
      id: artistTrackPlaybackContextId(artistId, 'popular'),
      label: detail.name,
    });
  const shuffleArtistAll = () =>
    shuffle(detail.top, {
      type: 'artist',
      id: artistTrackPlaybackContextId(artistId, 'popular'),
      label: detail.name,
    });
  const playArtistRow = (tracks: Track[], index: number, contextId: string) =>
    playRow(tracks, index, { type: 'artist', id: contextId, label: detail.name });

  const heroBlock = (
    <View style={styles.listHeader}>
      <ArtistHero
        artist={detail}
        followState={follow.state}
        following={follow.following}
        followUpdating={follow.updating}
        onToggleFollow={follow.toggle}
        onPlay={playArtistAll}
        onShuffle={shuffleArtistAll}
        onShare={() => {
          setRuntimeError(null);
          void shareArtist(detail.id, detail.name).catch(() => {
            setRuntimeError(catalogStrings.common.shareFailed);
          });
        }}
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
  );

  const trackList = (
    <ArtistVirtualizedList
      artistName={detail.name}
      liked={likedCollection}
      popularTracks={popularTracks}
      searchTracks={songSearch.results}
      searchActive={songSearch.active}
      refreshing={manualRefreshing}
      refreshAccessibilityLabel={catalogStrings.common.refreshing}
      onRefresh={refresh}
      header={tv.isTv ? null : heroBlock}
      likedHeader={
        <ArtistLikedTracksHeader
          artistName={detail.name}
          likes={likes}
          trackCount={likedTracks.length}
          expanded={likedExpanded}
          onToggleExpanded={() => setLikedExpanded((value) => !value)}
        />
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
          onSubmit={songSearch.submit}
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
          cardSize={tv.isTv ? tv.cardSize : undefined}
          onOpenAlbum={props.onOpenAlbum}
          onOpenArtist={props.onOpenArtist}
          onTagPress={(tag) => void startTagRadio(tag)}
          busyTag={busyTag}
        />
      }
      renderTrackItem={({ kind, track, index }) => {
        const isPopular = kind === 'popular';
        const playbackContextId = artistTrackPlaybackContextId(artistId, kind, songSearch.query);
        const contextTracks = {
          liked: likedTracks,
          popular: popularTracks,
          search: songSearch.results,
        }[kind];
        const testIdPrefix = {
          liked: 'artist-liked-track',
          popular: 'artist-track',
          search: 'artist-song-search-track',
        }[kind];
        return (
          <CatalogTrackRow
            track={track}
            index={index}
            testID={`${testIdPrefix}-${trackContextKey(track, index)}`}
            occurrence={{
              queueContext: { type: 'artist', id: playbackContextId },
              originalContextOrder: index,
            }}
            popularity={isPopular ? 'artist-popular' : 'none'}
            plays={isPopular ? trackPlays.data?.[track.id] : undefined}
            onPress={() => playArtistRow(contextTracks, index, playbackContextId)}
            onLongPress={() => showTrackActions(track, setRuntimeError)}
            onOpenAlbum={props.onOpenAlbum}
            onOpenArtist={props.onOpenArtist}
          />
        );
      }}
    />
  );

  return (
    <TvFocusScope scope="artist">
      <View
        testID="artist-screen"
        style={[
          styles.container,
          tv.isTv ? [styles.tvSplit, { gap: tv.gridGap }] : null,
        ]}
      >
        {tv.isTv ? (
          <>
            <ScrollView
              testID="artist-tv-hero-pane"
              showsVerticalScrollIndicator={false}
              style={{
                width: Math.round(tv.contentWidth * tv.splitPrimaryRatio),
                flexGrow: 0,
                flexShrink: 0,
              }}
              contentContainerStyle={{ paddingBottom: bottomInset }}
            >
              {heroBlock}
            </ScrollView>
            <View testID="artist-tv-tracks-pane" style={styles.tvTracksPane}>
              {trackList}
            </View>
          </>
        ) : (
          trackList
        )}
      </View>
    </TvFocusScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listHeader: { gap: layout.stackGap },
  seededLoading: { paddingTop: spacing.md, gap: layout.sectionGap },
  tvSplit: { flexDirection: 'row', alignItems: 'stretch' },
  tvTracksPane: { flex: 1, minWidth: 0 },
});
