import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Track } from '../api/types';
import {
  CatalogAlbumCard,
  CatalogArtistCard,
  CatalogHeroArtwork,
  CatalogTrackRow,
  HorizontalCatalogRail,
} from '../components/catalog/CatalogCards';
import { CatalogTrackList } from '../components/catalog/CatalogTrackList';
import { CatalogDetailHero } from '../components/catalog/CatalogDetailHero';
import {
  CatalogContentStatus,
  CatalogPageGate,
  CatalogRuntimeError,
  CatalogSection,
} from '../components/catalog/CatalogStates';
import { showTrackActions } from '../components/trackActions';
import { AppText, EmptyState, PlayButton, TrackRowSkeleton } from '../components/ui';
import { findCachedGenre, musicQueries } from '../data';
import { resolveRemoteVisualState } from '../data/remoteState';
import { useBottomInset } from '../hooks/useBottomInset';
import { playTrackRow, playTracks } from '../player/controller';
import { colors, layout, spacing } from '../theme';
import { TvFocusScope, useTvEnvironment, useTvFocusReturn } from '../tv';
import {
  assertGenreScreenContract,
  catalogTestIdSegment,
  genreHasContent,
  playbackSelection,
  requireCatalogId,
  trackContextKey,
  type GenreScreenContract,
} from './catalogModel';
import { catalogFailureMessage } from './catalogFeedback';
import { catalogStrings } from './catalogStrings';

export type GenreScreenProps = GenreScreenContract;
export type { AlbumRouteParams, ArtistRouteParams, GenreRouteParams } from './catalogModel';

const EMPTY_TRACKS: readonly Track[] = [];

const settledSectionState = {
  hasData: true,
  isPending: false,
  isFetching: false,
  isStale: false,
  fetchStatus: 'idle',
  error: null,
} as const;

export default function GenreScreen(props: GenreScreenProps) {
  assertGenreScreenContract(props);
  const genreId = requireCatalogId(props.genreId, 'genre id');
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const bottomInset = useBottomInset();
  const tv = useTvEnvironment();
  useTvFocusReturn({ scope: 'genre', active: isFocused, enabled: tv.isTv });
  const genre = useQuery(musicQueries.genre(genreId));
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const seededGenre = useMemo(
    () => findCachedGenre(queryClient, genreId),
    [genreId, queryClient],
  );
  const routeName = props.name?.trim() ?? '';

  const refetch = useCallback(() => void genre.refetch(), [genre]);
  const pullToRefresh = useCallback(() => {
    setManualRefreshing(true);
    void genre.refetch().finally(() => setManualRefreshing(false));
  }, [genre]);

  const initialVisual = resolveRemoteVisualState({
    hasData: genre.data !== undefined,
    empty: false,
    pending: genre.isPending,
    fetching: genre.isFetching,
    stale: genre.isStale,
    fetchStatus: genre.fetchStatus,
    error: genre.error,
  });
  const seededInitialLoading =
    genre.data === undefined
    && initialVisual.body === 'loading'
    && (seededGenre !== null || routeName.length > 0);

  if (genre.data === undefined && !seededInitialLoading) {
    return (
      <CatalogPageGate
        id="genre"
        variant="compact"
        hasData={false}
        isPending={genre.isPending}
        isFetching={genre.isFetching}
        isStale={genre.isStale}
        fetchStatus={genre.fetchStatus}
        error={genre.error}
        loadingLabel={catalogStrings.genre.loading}
        onRetry={refetch}
      />
    );
  }

  const detail = genre.data;
  const genreName = detail?.name ?? seededGenre?.name ?? routeName;
  const genrePicture = detail?.picture ?? seededGenre?.picture ?? '';
  const tracks = detail?.tracks ?? EMPTY_TRACKS;

  const startGenrePlayback = (index: number, mode: 'context' | 'row') => {
    if (detail === undefined) return;
    let selected: ReturnType<typeof playbackSelection>;
    try {
      selected = playbackSelection(detail.tracks, index);
    } catch (error) {
      setRuntimeError(catalogFailureMessage('playback', error));
      return;
    }
    setRuntimeError(null);
    const runner = mode === 'row' ? playTrackRow : playTracks;
    void runner(selected.tracks, selected.startIndex, {
      context: { type: 'genre', id: genreId, label: detail.name },
    }).catch((error) =>
      setRuntimeError(catalogFailureMessage('playback', error)),
    );
  };

  const heroBlock = (
    <View style={styles.heroBlock}>
      <CatalogDetailHero
        artwork={<CatalogHeroArtwork uri={genrePicture} compact={!tv.isTv} />}
        actions={
          <PlayButton
            testID="genre-play-all"
            size="lg"
            accessibilityLabel={catalogStrings.common.playAll}
            disabled={detail === undefined || detail.tracks.length === 0}
            hasTVPreferredFocus={
              tv.isTv && isFocused && detail !== undefined && detail.tracks.length > 0
                ? true
                : undefined
            }
            onPress={() => startGenrePlayback(0, 'context')}
          />
        }
      >
        <AppText
          testID="genre-title"
          accessibilityRole="header"
          variant={tv.isTv ? 'hero' : 'title'}
          numberOfLines={2}
        >
          {genreName}
        </AppText>
        {detail !== undefined ? (
          <AppText variant="callout" color="secondary">
            {catalogStrings.common.tracks(detail.tracks.length)}
          </AppText>
        ) : null}
      </CatalogDetailHero>
      <CatalogRuntimeError id="genre" message={runtimeError} />
      {detail !== undefined ? (
        <CatalogContentStatus
          id="genre"
          hasData
          isPending={genre.isPending}
          isFetching={genre.isFetching}
          isStale={genre.isStale}
          fetchStatus={genre.fetchStatus}
          error={genre.error}
          refreshIndicator={false}
          onRetry={refetch}
        />
      ) : null}
      {detail !== undefined && !genreHasContent(detail) ? (
        <EmptyState
          testID="genre-empty"
          icon="music-off"
          title={catalogStrings.genre.empty}
        />
      ) : null}
    </View>
  );

  const trackHeading = detail !== undefined ? (
    <CatalogSection
      id="genre-tracks"
      title={catalogStrings.genre.popularTracks}
      empty={detail.tracks.length === 0}
      onRetry={() => undefined}
      {...settledSectionState}
    >
      <View testID="genre-track-list" />
    </CatalogSection>
  ) : null;

  const footerContent = detail !== undefined ? (
    <View style={styles.footerContent}>
      <CatalogSection
        id="genre-albums"
        title={catalogStrings.genre.albums}
        empty={detail.albums.length === 0}
        onRetry={() => undefined}
        {...settledSectionState}
      >
        <HorizontalCatalogRail
          id="genre-albums"
          data={detail.albums}
          keyExtractor={(album) => album.id}
          renderItem={(album) => (
            <CatalogAlbumCard
              album={album}
              cardSize={tv.isTv ? tv.cardSize : undefined}
              testID={`genre-album-${catalogTestIdSegment(album.id)}`}
              onPress={() => props.onOpenAlbum({ albumId: album.id, title: album.title })}
            />
          )}
        />
      </CatalogSection>

      <CatalogSection
        id="genre-artists"
        title={catalogStrings.genre.artists}
        empty={detail.artists.length === 0}
        onRetry={() => undefined}
        {...settledSectionState}
      >
        <HorizontalCatalogRail
          id="genre-artists"
          data={detail.artists}
          keyExtractor={(artist) => artist.id}
          renderItem={(artist) => (
            <CatalogArtistCard
              artist={artist}
              cardSize={tv.isTv ? tv.cardSize : undefined}
              testID={`genre-artist-${catalogTestIdSegment(artist.id)}`}
              onPress={() => props.onOpenArtist({ artistId: artist.id, name: artist.name })}
            />
          )}
        />
      </CatalogSection>
    </View>
  ) : null;

  const trackList = (
    <CatalogTrackList
      id="genre"
      tracks={tracks}
      refreshing={manualRefreshing}
      refreshAccessibilityLabel={catalogStrings.common.refreshing}
      onRefresh={pullToRefresh}
      header={
        tv.isTv ? (
          trackHeading
        ) : (
          <View style={styles.headerContent}>
            {heroBlock}
            {trackHeading}
          </View>
        )
      }
      footer={footerContent}
      empty={
        seededInitialLoading ? (
          <TrackRowSkeleton
            testID="genre-loading"
            accessibilityLabel={catalogStrings.genre.loading}
            count={5}
          />
        ) : null
      }
      renderTrack={(track, index) => (
        <CatalogTrackRow
          track={track}
          index={index}
          testID={`genre-track-${trackContextKey(track, index)}`}
          occurrence={{
            queueContext: { type: 'genre', id: genreId },
            originalContextOrder: index,
          }}
          onPress={() => startGenrePlayback(index, 'row')}
          onLongPress={() => showTrackActions(track, setRuntimeError)}
          onOpenAlbum={props.onOpenAlbum}
          onOpenArtist={props.onOpenArtist}
        />
      )}
    />
  );

  return (
    <TvFocusScope scope="genre">
      <View
        testID="genre-screen"
        style={[
          styles.container,
          tv.isTv ? [styles.tvSplit, { gap: tv.gridGap }] : null,
        ]}
      >
        {tv.isTv ? (
          <>
            <ScrollView
              testID="genre-tv-hero-pane"
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
            <View testID="genre-tv-tracks-pane" style={styles.tvTracksPane}>
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
  heroBlock: { gap: layout.stackGap },
  headerContent: { gap: layout.sectionGap, paddingTop: spacing.md },
  footerContent: { gap: layout.sectionGap, paddingTop: layout.sectionGap },
  tvSplit: { flexDirection: 'row', alignItems: 'stretch' },
  tvTracksPane: { flex: 1, minWidth: 0 },
});
