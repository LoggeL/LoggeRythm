import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { CatalogHeroArtwork, CatalogTrackRow } from '../components/catalog/CatalogCards';
import { CatalogCollectionPage } from '../components/catalog/CatalogCollectionPage';
import { CatalogDetailHero } from '../components/catalog/CatalogDetailHero';
import {
  CatalogContentStatus,
  CatalogPageGate,
  CatalogRuntimeError,
} from '../components/catalog/CatalogStates';
import { catalogQueryFlags } from '../components/catalog/catalogQueryState';
import { showTrackActions } from '../components/trackActions';
import { ActionButton, AppText, EmptyState } from '../components/ui';
import { musicQueries } from '../data';
import { metrics, opacity } from '../theme';
import {
  albumHasContent,
  albumRuntimeMinutes,
  assertAlbumScreenContract,
  catalogTestIdSegment,
  releaseYear,
  requireCatalogId,
  trackContextKey,
  type AlbumScreenContract,
} from './catalogModel';
import { catalogStrings } from './catalogStrings';
import { useCatalogPlayback } from './useCatalogPlayback';

export type AlbumScreenProps = AlbumScreenContract;
export type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';

export default function AlbumScreen(props: AlbumScreenProps) {
  assertAlbumScreenContract(props);
  const albumId = requireCatalogId(props.albumId, 'album id');
  const album = useQuery(musicQueries.album(albumId));
  const { runtimeError, setRuntimeError, play } = useCatalogPlayback();
  const refetch = () => void album.refetch();

  if (album.data === undefined) {
    return (
      <CatalogPageGate
        id="album"
        hasData={false}
        {...catalogQueryFlags(album)}
        loadingLabel={catalogStrings.album.loading}
        onRetry={refetch}
      />
    );
  }

  const detail = album.data;
  const year = releaseYear(detail.release_date);
  const runtimeMinutes = albumRuntimeMinutes(detail.tracks);
  const artistId = String(detail.artist_id).trim();
  const openArtist =
    artistId.length > 0
      ? () => props.onOpenArtist({ artistId, name: detail.artist })
      : undefined;
  const playFrom = (index: number) =>
    play(detail.tracks, index, { type: 'album', id: albumId, label: detail.title });
  const facts = [
    year ? catalogStrings.common.releaseYear(year) : null,
    catalogStrings.common.tracks(detail.nb_tracks),
  ].filter((fact): fact is string => fact !== null);

  return (
    <CatalogCollectionPage
      id="album"
      tracks={detail.tracks}
      refreshing={album.isFetching && !album.isPending}
      refreshAccessibilityLabel={catalogStrings.common.refreshing}
      onRefresh={refetch}
      trackListTitle={catalogStrings.album.tracks}
      hero={
        <CatalogDetailHero
          artwork={<CatalogHeroArtwork uri={detail.cover} />}
          eyebrow={catalogStrings.album.typeLabel}
          title={detail.title}
          titleTestID="album-title"
          play={{
            testID: 'album-play-all',
            accessibilityLabel: catalogStrings.common.playAll,
            disabled: detail.tracks.length === 0,
            onPress: () => playFrom(0),
          }}
        >
          {openArtist !== undefined ? (
            <Pressable
              testID={`album-artist-${catalogTestIdSegment(artistId)}`}
              accessibilityRole="button"
              accessibilityLabel={catalogStrings.common.openArtist(detail.artist)}
              onPress={openArtist}
              style={({ pressed }) => [styles.artistLink, pressed && styles.pressed]}
            >
              <AppText variant="label" numberOfLines={1}>
                {catalogStrings.album.byArtist(detail.artist)}
              </AppText>
            </Pressable>
          ) : (
            <AppText variant="label" numberOfLines={1}>
              {catalogStrings.album.byArtist(detail.artist)}
            </AppText>
          )}
          <AppText variant="callout" color="secondary" numberOfLines={2}>
            {facts.join(' · ')}
            {runtimeMinutes !== null ? (
              <>
                {' · '}
                <AppText testID="album-runtime" variant="callout" color="secondary">
                  {catalogStrings.album.runtime(runtimeMinutes)}
                </AppText>
              </>
            ) : null}
          </AppText>
        </CatalogDetailHero>
      }
      status={
        <>
          <CatalogRuntimeError id="album" message={runtimeError} />
          <CatalogContentStatus
            id="album"
            hasData
            {...catalogQueryFlags(album)}
            refreshIndicator={false}
            onRetry={refetch}
          />
        </>
      }
      empty={
        !albumHasContent(detail) ? (
          <EmptyState
            testID="album-empty"
            icon="album"
            title={catalogStrings.album.empty}
            action={
              openArtist !== undefined ? (
                <ActionButton
                  testID="album-empty-open-artist"
                  variant="secondary"
                  icon="account-music"
                  label={detail.artist}
                  accessibilityLabel={catalogStrings.common.openArtist(detail.artist)}
                  onPress={openArtist}
                />
              ) : undefined
            }
          />
        ) : null
      }
      renderTrack={(track, index) => (
        <CatalogTrackRow
          track={track}
          index={index}
          testID={`album-track-${trackContextKey(track, index)}`}
          occurrence={{
            queueContext: { type: 'album', id: albumId },
            originalContextOrder: index,
          }}
          showAlbumLabel={false}
          onPress={() => playFrom(index)}
          onLongPress={() => showTrackActions(track, setRuntimeError)}
          onOpenAlbum={props.onOpenAlbum}
          onOpenArtist={props.onOpenArtist}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  artistLink: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  pressed: { opacity: opacity.pressed },
});
