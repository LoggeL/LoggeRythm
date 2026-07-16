import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Track } from '../api/types';
import {
  CatalogActionButton,
  CatalogAlbumCard,
  CatalogArtistCard,
  CatalogHeroArtwork,
  CatalogTrackRow,
  HorizontalCatalogRail,
} from '../components/catalog/CatalogCards';
import { ArtistVirtualizedList } from '../components/catalog/ArtistVirtualizedList';
import {
  CatalogContentStatus,
  CatalogPageGate,
  CatalogQueryBoundary,
  CatalogRuntimeError,
  CatalogSection,
} from '../components/catalog/CatalogStates';
import { showTrackActions } from '../components/trackActions';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_API_BASE, normalizeApiBase } from '../config';
import {
  createArtistFollowMutationOptions,
  musicCacheScope,
  musicQueries,
} from '../data';
import { strings } from '../localization';
import { refreshBrowseTree } from '../player/browseTree';
import { playTracks } from '../player/controller';
import { reportPlayerNotice } from '../player/notices';
import { colors } from '../theme';
import {
  artistHasContent,
  artistPopularTracks,
  artistSongSearchQuery,
  artistSummary,
  artistTrackPlaybackContextId,
  assertArtistScreenContract,
  catalogTestIdSegment,
  filterArtistTracks,
  followingValue,
  playbackSelection,
  requireCatalogId,
  trackContextKey,
  type ArtistScreenContract,
} from './catalogModel';
import { catalogFailureMessage } from './catalogFeedback';
import { catalogStrings } from './catalogStrings';

export type ArtistScreenProps = ArtistScreenContract;
export type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';

const settledSectionState = {
  hasData: true,
  isPending: false,
  isFetching: false,
  isStale: false,
  fetchStatus: 'idle',
  error: null,
} as const;

export default function ArtistScreen(props: ArtistScreenProps) {
  assertArtistScreenContract(props);
  const artistId = requireCatalogId(props.artistId, 'artist id');
  const { user } = useAuth();
  if (user === null) throw new Error('ArtistScreen requires an authenticated user');

  const queryClient = useQueryClient();
  const scope = musicCacheScope(normalizeApiBase(DEFAULT_API_BASE), user.id);
  const artist = useQuery(musicQueries.artist(artistId));
  const artistName = artist.data?.name.trim() ?? '';
  const aboutEnabled = artistName.length > 0;
  const about = useQuery({
    ...musicQueries.artistAbout(artistName || '__artist_pending__'),
    enabled: aboutEnabled,
  });
  const followOptions = musicQueries.followingContains(scope, [artistId]);
  const followState = useQuery(followOptions);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [songInputState, setSongInputState] = useState({ artistId, value: '' });
  const [songQueryState, setSongQueryState] = useState({ artistId, value: '' });
  const songInput = songInputState.artistId === artistId ? songInputState.value : '';
  const songQuery = songQueryState.artistId === artistId ? songQueryState.value : '';

  useEffect(() => {
    const timer = setTimeout(
      () => setSongQueryState({ artistId, value: songInput.trim() }),
      300,
    );
    return () => clearTimeout(timer);
  }, [artistId, songInput]);

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
  const trackPlays = useQuery({
    ...musicQueries.trackPlayCounts(trackPlayRequest),
    enabled: trackPlayRequest.length > 0,
  });
  const songSearchRequest = artistSongSearchQuery(artistName, songQuery);
  const songSearch = useQuery({
    ...musicQueries.searchTracks(songSearchRequest ?? ''),
    enabled: songSearchRequest !== null,
    staleTime: 5 * 60_000,
  });
  const songResults = filterArtistTracks(songSearch.data ?? [], artistId, artistName);

  const detailSummary = artist.data === undefined ? null : artistSummary(artist.data);
  const followMutation = useMutation(
    createArtistFollowMutationOptions({
      queryClient,
      scope,
      artist: detailSummary ?? { id: artistId, name: '', picture: '' },
      refreshAutoBrowse: refreshBrowseTree,
      onMutationSuccess: () => setRuntimeError(null),
      onMutationError: (error) => {
        setRuntimeError(catalogFailureMessage('artist-follow', error));
      },
      onAutoBrowseError: () => {
        reportPlayerNotice(
          'bookkeeping',
          'auto-library-refresh',
          strings.player.autoLibraryFailed,
          strings.player.autoLibraryRefreshFailedMessage,
        );
      },
    }),
  );

  if (artist.data === undefined) {
    return (
      <CatalogPageGate
        id="artist"
        hasData={false}
        isPending={artist.isPending}
        isFetching={artist.isFetching}
        isStale={artist.isStale}
        fetchStatus={artist.fetchStatus}
        error={artist.error}
        loadingLabel={catalogStrings.artist.loading}
        onRetry={() => void artist.refetch()}
      />
    );
  }

  const detail = artist.data;
  const following = followingValue(followState.data, artistId);
  const followDisabled = followMutation.isPending;
  const followLabel = followMutation.isPending
      ? catalogStrings.artist.followUpdating
      : following
        ? catalogStrings.artist.following
        : catalogStrings.artist.follow;
  const followAccessibilityLabel = following
    ? catalogStrings.artist.unfollowArtist(detail.name)
    : catalogStrings.artist.followArtist(detail.name);

  const play = (tracks: Track[], index: number, contextId: string) => {
    let selected: ReturnType<typeof playbackSelection>;
    try {
      selected = playbackSelection(tracks, index);
    } catch (error) {
      setRuntimeError(catalogFailureMessage('playback', error));
      return;
    }
    setRuntimeError(null);
    void playTracks(selected.tracks, selected.startIndex, {
      context: { type: 'artist', id: contextId, label: detail.name },
    }).catch((error) =>
      setRuntimeError(catalogFailureMessage('playback', error)),
    );
  };

  const refresh = () => {
    void Promise.allSettled([
      artist.refetch(),
      followState.refetch(),
      ...(aboutEnabled ? [about.refetch()] : []),
      ...(trackPlayRequest.length > 0 ? [trackPlays.refetch()] : []),
      ...(songSearchRequest !== null ? [songSearch.refetch()] : []),
    ]);
  };
  const refreshing = [artist, followState, about, trackPlays, songSearch].some(
    (query) => query.isFetching && !query.isPending,
  );
  const aboutHasContent =
    about.data !== undefined &&
    (about.data.bio.trim().length > 0 ||
      about.data.tags.length > 0 ||
      about.data.listeners > 0 ||
      about.data.playcount > 0);

  return (
    <View testID="artist-screen" style={styles.container}>
      <ArtistVirtualizedList
        artistName={detail.name}
        popularTracks={popularTracks}
        searchTracks={songResults}
        searchActive={songQuery.length > 0}
        refreshing={refreshing}
        refreshAccessibilityLabel={catalogStrings.common.refreshing}
        onRefresh={refresh}
        header={
          <View style={styles.listHeader}>
            <View style={styles.hero}>
              <CatalogHeroArtwork uri={detail.picture} round />
              <Text testID="artist-type-label" style={styles.typeLabel}>
                {catalogStrings.artist.typeLabel}
              </Text>
              <Text testID="artist-title" accessibilityRole="header" style={styles.title}>
                {detail.name}
              </Text>
              {detail.fans > 0 ? (
                <Text testID="artist-fans" style={styles.meta}>
                  {catalogStrings.artist.fans(detail.fans)}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <CatalogActionButton
                  testID="artist-play-all"
                  label={catalogStrings.common.play}
                  disabled={detail.top.length === 0}
                  onPress={() => play(
                    detail.top,
                    0,
                    artistTrackPlaybackContextId(artistId, 'popular'),
                  )}
                />
                <CatalogQueryBoundary
                  id="artist-follow-state"
                  hasData={followState.data !== undefined}
                  empty={false}
                  isPending={followState.isPending}
                  isFetching={followState.isFetching}
                  isStale={followState.isStale}
                  fetchStatus={followState.fetchStatus}
                  error={followState.error}
                  loadingLabel={catalogStrings.artist.followLoading}
                  emptyLabel={catalogStrings.artist.followStateFailed}
                  errorLabel={catalogStrings.artist.followStateFailed}
                  retryLabel={catalogStrings.common.retry}
                  onRetry={() => void followState.refetch()}
                >
                  <CatalogActionButton
                    testID="artist-follow-toggle"
                    label={followLabel}
                    accessibilityLabel={followAccessibilityLabel}
                    disabled={followDisabled}
                    secondary={following}
                    onPress={() => followMutation.mutate(!following)}
                  />
                </CatalogQueryBoundary>
              </View>
            </View>

            <CatalogRuntimeError id="artist" message={runtimeError} />
            <CatalogContentStatus
              id="artist"
              hasData
              isPending={artist.isPending}
              isFetching={artist.isFetching}
              isStale={artist.isStale}
              fetchStatus={artist.fetchStatus}
              error={artist.error}
              onRetry={() => void artist.refetch()}
            />
            {!artistHasContent(detail) ? (
              <Text testID="artist-empty" style={styles.empty}>
                {catalogStrings.artist.empty}
              </Text>
            ) : null}
          </View>
        }
        popularHeader={
          <CatalogSection
            id="artist-top-tracks"
            title={catalogStrings.artist.topTracks}
            hasData
            empty={popularTracks.length === 0}
            isPending={popularTracks.length > 0 && trackPlays.isPending}
            isFetching={popularTracks.length > 0 && trackPlays.isFetching}
            isStale={popularTracks.length > 0 && trackPlays.isStale}
            fetchStatus={popularTracks.length > 0 ? trackPlays.fetchStatus : 'idle'}
            error={popularTracks.length > 0 ? trackPlays.error : null}
            onRetry={() => void trackPlays.refetch()}
          >
            <View testID="artist-track-list" />
          </CatalogSection>
        }
        searchHeader={
          <View testID="artist-song-search" style={styles.songSearch}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              {catalogStrings.artist.searchSongs}
            </Text>
            <TextInput
              testID="artist-song-search-input"
              accessibilityLabel={catalogStrings.artist.searchSongsLabel(detail.name)}
              value={songInput}
              onChangeText={(value) => setSongInputState({ artistId, value })}
              placeholder={catalogStrings.artist.searchSongsPlaceholder(detail.name)}
              placeholderTextColor={colors.textSecondary}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.songSearchInput}
            />
            {songQuery.length === 0 ? null : (
              <CatalogQueryBoundary
                id="artist-song-search-state"
                hasData={songSearch.data !== undefined}
                empty={songSearch.data !== undefined && songResults.length === 0}
                isPending={songSearch.isPending}
                isFetching={songSearch.isFetching}
                isStale={songSearch.isStale}
                fetchStatus={songSearch.fetchStatus}
                error={songSearch.error}
                loadingLabel={catalogStrings.artist.searchSongsLoading}
                emptyLabel={catalogStrings.artist.searchSongsEmpty(songQuery)}
                errorLabel={catalogStrings.artist.searchSongsFailed}
                retryLabel={catalogStrings.common.retry}
                onRetry={() => void songSearch.refetch()}
              >
                <View testID="artist-song-search-results" />
              </CatalogQueryBoundary>
            )}
          </View>
        }
        footer={
          <View style={styles.listFooter}>
            <CatalogSection
              id="artist-albums"
              title={catalogStrings.artist.albums}
              empty={detail.albums.length === 0}
              onRetry={() => undefined}
              {...settledSectionState}
            >
              <HorizontalCatalogRail
                id="artist-albums"
                data={detail.albums}
                keyExtractor={(album) => album.id}
                renderItem={(album) => (
                  <CatalogAlbumCard
                    album={album}
                    testID={`artist-album-${catalogTestIdSegment(album.id)}`}
                    onPress={() => props.onOpenAlbum({ albumId: album.id, title: album.title })}
                  />
                )}
              />
            </CatalogSection>

            <CatalogSection
              id="artist-related"
              title={catalogStrings.artist.relatedArtists}
              empty={detail.related.length === 0}
              onRetry={() => undefined}
              {...settledSectionState}
            >
              <HorizontalCatalogRail
                id="artist-related"
                data={detail.related}
                keyExtractor={(related) => related.id}
                renderItem={(related) => (
                  <CatalogArtistCard
                    artist={related}
                    testID={`artist-related-${catalogTestIdSegment(related.id)}`}
                    onPress={() => props.onOpenArtist({
                      artistId: related.id,
                      name: related.name,
                    })}
                  />
                )}
              />
            </CatalogSection>

            <CatalogSection
              id="artist-about"
              title={catalogStrings.artist.about}
              hasData={!aboutEnabled || about.data !== undefined}
              empty={!aboutEnabled || !aboutHasContent}
              isPending={aboutEnabled && about.isPending}
              isFetching={aboutEnabled && about.isFetching}
              isStale={aboutEnabled && about.isStale}
              fetchStatus={aboutEnabled ? about.fetchStatus : 'idle'}
              error={aboutEnabled ? about.error : null}
              onRetry={() => void about.refetch()}
            >
              {about.data !== undefined ? (
                <View testID="artist-about-content" style={styles.about}>
                  {about.data.bio.trim().length > 0 ? (
                    <Text style={styles.bio}>{about.data.bio.trim()}</Text>
                  ) : null}
                  <View style={styles.metaLine}>
                    <Text style={styles.meta}>
                      {catalogStrings.artist.listeners(about.data.listeners)}
                    </Text>
                    <Text style={styles.meta}>
                      {catalogStrings.artist.plays(about.data.playcount)}
                    </Text>
                  </View>
                  {about.data.tags.length > 0 ? (
                    <View style={styles.tags}>
                      {about.data.tags.map((tag) => (
                        <Text key={tag} style={styles.tag}>{tag}</Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </CatalogSection>
          </View>
        }
        renderTrackItem={({ kind, track, index }) => {
          const isPopular = kind === 'popular';
          const playCount = isPopular ? trackPlays.data?.[track.id] : undefined;
          const context = isPopular ? popularTracks : songResults;
          const playbackContextId = artistTrackPlaybackContextId(
            artistId,
            isPopular ? 'popular' : 'search',
            songQuery,
          );
          const testID = isPopular
            ? `artist-track-${trackContextKey(track, index)}`
            : `artist-song-search-track-${trackContextKey(track, index)}`;
          return (
            <CatalogTrackRow
              track={track}
              index={index}
              testID={testID}
              occurrence={{
                queueContext: { type: 'artist', id: playbackContextId },
                originalContextOrder: index,
              }}
              popularity={isPopular ? 'artist-popular' : 'none'}
              plays={playCount}
              onPress={() => play(context, index, playbackContextId)}
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
  listHeader: { gap: 28 },
  listFooter: { gap: 28, paddingTop: 28 },
  hero: { alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  typeLabel: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
    textAlign: 'center',
  },
  metaLine: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  meta: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  empty: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, paddingHorizontal: 16 },
  songSearch: { gap: 12 },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    paddingHorizontal: 16,
  },
  songSearchInput: {
    minHeight: 48,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
    fontSize: 15,
  },
  about: { gap: 14, paddingHorizontal: 16 },
  bio: { color: colors.textPrimary, fontSize: 14, lineHeight: 22 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surfaceElevated,
  },
});
