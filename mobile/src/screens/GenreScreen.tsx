import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
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
import { AppText, EmptyState, PlayButton } from '../components/ui';
import { musicQueries } from '../data';
import { playTracks } from '../player/controller';
import { colors, layout, spacing } from '../theme';
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
  const genre = useQuery(musicQueries.genre(genreId));
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  if (genre.data === undefined) {
    return (
      <CatalogPageGate
        id="genre"
        hasData={false}
        isPending={genre.isPending}
        isFetching={genre.isFetching}
        isStale={genre.isStale}
        fetchStatus={genre.fetchStatus}
        error={genre.error}
        loadingLabel={catalogStrings.genre.loading}
        onRetry={() => void genre.refetch()}
      />
    );
  }

  const detail = genre.data;
  const play = (index: number) => {
    let selected: ReturnType<typeof playbackSelection>;
    try {
      selected = playbackSelection(detail.tracks, index);
    } catch (error) {
      setRuntimeError(catalogFailureMessage('playback', error));
      return;
    }
    setRuntimeError(null);
    void playTracks(selected.tracks, selected.startIndex, {
      context: { type: 'genre', id: genreId, label: detail.name },
    }).catch((error) =>
      setRuntimeError(catalogFailureMessage('playback', error)),
    );
  };

  return (
    <View testID="genre-screen" style={styles.container}>
      <CatalogTrackList
        id="genre"
        tracks={detail.tracks}
        refreshing={genre.isFetching && !genre.isPending}
        refreshAccessibilityLabel={catalogStrings.common.refreshing}
        onRefresh={() => void genre.refetch()}
        header={
          <View style={styles.headerContent}>
            <CatalogDetailHero
              artwork={<CatalogHeroArtwork uri={detail.picture} compact />}
              actions={
                <PlayButton
                  testID="genre-play-all"
                  size="lg"
                  accessibilityLabel={catalogStrings.common.playAll}
                  disabled={detail.tracks.length === 0}
                  onPress={() => play(0)}
                />
              }
            >
              <AppText
                testID="genre-title"
                accessibilityRole="header"
                variant="title"
                numberOfLines={2}
              >
                {detail.name}
              </AppText>
              <AppText variant="callout" color="secondary">
                {catalogStrings.common.tracks(detail.tracks.length)}
              </AppText>
            </CatalogDetailHero>
            <CatalogRuntimeError id="genre" message={runtimeError} />
            <CatalogContentStatus
              id="genre"
              hasData
              isPending={genre.isPending}
              isFetching={genre.isFetching}
              isStale={genre.isStale}
              fetchStatus={genre.fetchStatus}
              error={genre.error}
              onRetry={() => void genre.refetch()}
            />
            {!genreHasContent(detail) ? (
              <EmptyState
                testID="genre-empty"
                icon="music-off"
                title={catalogStrings.genre.empty}
              />
            ) : null}

            <CatalogSection
              id="genre-tracks"
              title={catalogStrings.genre.popularTracks}
              empty={detail.tracks.length === 0}
              onRetry={() => undefined}
              {...settledSectionState}
            >
              <View testID="genre-track-list" />
            </CatalogSection>
          </View>
        }
        footer={
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
                    testID={`genre-artist-${catalogTestIdSegment(artist.id)}`}
                    onPress={() => props.onOpenArtist({ artistId: artist.id, name: artist.name })}
                  />
                )}
              />
            </CatalogSection>
          </View>
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
            onPress={() => play(index)}
            onLongPress={() => showTrackActions(track, setRuntimeError)}
            onOpenAlbum={props.onOpenAlbum}
            onOpenArtist={props.onOpenArtist}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerContent: { gap: layout.sectionGap, paddingTop: spacing.md },
  footerContent: { gap: layout.sectionGap, paddingTop: layout.sectionGap },
});
