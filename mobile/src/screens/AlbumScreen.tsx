import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Track } from '../api/types';
import { useAuth } from '../auth/AuthContext';
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
import {
  ActionButton,
  AppText,
  createFocusRingController,
  EmptyState,
  FocusRingOverlay,
  IconButton,
  TrackRowSkeleton,
} from '../components/ui';
import { getCurrentApiBase } from '../config';
import { findCachedAlbumSummary, musicCacheScope, musicQueries } from '../data';
import { resolveRemoteVisualState } from '../data/remoteState';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { useTrackCollectionOffline } from '../offline/useTrackCollectionOffline';
import { shareAlbum } from '../share/outboundShare';
import { metrics, opacity, radii } from '../theme';
import { TvFocusScope, useTvEnvironment, useTvFocusReturn } from '../tv';
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

const EMPTY_TRACKS: readonly Track[] = [];

export default function AlbumScreen(props: AlbumScreenProps) {
  assertAlbumScreenContract(props);
  const albumId = requireCatalogId(props.albumId, 'album id');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const bottomInset = useBottomInset();
  const tv = useTvEnvironment();
  useTvFocusReturn({ scope: 'album', active: isFocused, enabled: tv.isTv });
  const scope = user !== null ? musicCacheScope(getCurrentApiBase(), user.id) : undefined;
  const album = useQuery(musicQueries.album(albumId));
  const { runtimeError, setRuntimeError, play, playRow, shuffle } = useCatalogPlayback();
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [artistFocusController] = useState(createFocusRingController);
  const albumOffline = useTrackCollectionOffline({
    scope: scope ?? null,
    jobId: albumId,
    tracks: album.data?.tracks ?? EMPTY_TRACKS,
    downloadFailedMessage: catalogStrings.album.downloadFailed,
    removeFailedMessage: catalogStrings.album.removeDownloadFailed,
    onError: setRuntimeError,
  });

  const seededAlbum = useMemo(
    () => findCachedAlbumSummary(queryClient, albumId, scope),
    [albumId, queryClient, scope],
  );
  const routeTitle = props.title?.trim() ?? '';

  const refetch = useCallback(() => void album.refetch(), [album]);
  const pullToRefresh = useCallback(() => {
    setManualRefreshing(true);
    void album.refetch().finally(() => setManualRefreshing(false));
  }, [album]);

  const initialVisual = resolveRemoteVisualState({
    hasData: album.data !== undefined,
    empty: false,
    pending: album.isPending,
    fetching: album.isFetching,
    stale: album.isStale,
    fetchStatus: album.fetchStatus,
    error: album.error,
  });
  const seededInitialLoading =
    album.data === undefined
    && initialVisual.body === 'loading'
    && (seededAlbum !== null || routeTitle.length > 0);

  if (album.data === undefined && !seededInitialLoading) {
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
  const title = detail?.title ?? seededAlbum?.title ?? routeTitle;
  const cover = detail?.cover ?? seededAlbum?.cover ?? '';
  const artistName = detail?.artist ?? seededAlbum?.artist ?? '';
  const tracks = detail?.tracks ?? EMPTY_TRACKS;
  const year = releaseYear(detail?.release_date ?? seededAlbum?.release_date ?? '');
  const runtimeMinutes = detail !== undefined ? albumRuntimeMinutes(detail.tracks) : null;
  const artistId = detail !== undefined ? String(detail.artist_id).trim() : '';
  const openArtist =
    artistId.length > 0
      ? () => props.onOpenArtist({ artistId, name: artistName })
      : undefined;
  const context = { type: 'album' as const, id: albumId, label: title };
  const playAll = () => {
    if (detail === undefined) return;
    play(detail.tracks, 0, context);
  };
  const shuffleAll = () => {
    if (detail === undefined) return;
    shuffle(detail.tracks, context);
  };
  const playTrack = (index: number) => {
    if (detail === undefined) return;
    playRow(detail.tracks, index, context);
  };
  const facts = [
    year ? catalogStrings.common.releaseYear(year) : null,
    detail !== undefined ? catalogStrings.common.tracks(detail.nb_tracks) : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <TvFocusScope scope="album">
      <CatalogCollectionPage
        id="album"
        tracks={tracks}
        refreshing={manualRefreshing}
        refreshAccessibilityLabel={catalogStrings.common.refreshing}
        onRefresh={pullToRefresh}
        trackListTitle={catalogStrings.album.tracks}
        tv={tv}
        bottomInset={bottomInset}
        hero={
          <CatalogDetailHero
            artwork={<CatalogHeroArtwork uri={cover} />}
            eyebrow={catalogStrings.album.typeLabel}
            title={title}
            titleTestID="album-title"
            actions={
              <>
                <IconButton
                  testID="album-download"
                  icon={
                    albumOffline.phase === 'downloaded'
                      ? 'check-circle'
                      : 'download-circle-outline'
                  }
                  variant="tonal"
                  selected={albumOffline.phase === 'downloaded'}
                  busy={albumOffline.busy}
                  disabled={detail === undefined || detail.tracks.length === 0 || scope === undefined}
                  accessibilityLabel={
                    albumOffline.phase === 'downloaded'
                      ? catalogStrings.album.removeDownload
                      : catalogStrings.album.download
                  }
                  onPress={
                    albumOffline.phase === 'downloaded'
                      ? albumOffline.removeAll
                      : albumOffline.downloadAll
                  }
                />
                <IconButton
                  testID="album-share"
                  icon="share-variant"
                  variant="tonal"
                  accessibilityLabel={catalogStrings.common.share}
                  disabled={title.length === 0}
                  onPress={() => {
                    setRuntimeError(null);
                    void shareAlbum(albumId, title, artistName).catch(() => {
                      setRuntimeError(catalogStrings.common.shareFailed);
                    });
                  }}
                />
              </>
            }
            shuffle={{
              testID: 'album-shuffle',
              accessibilityLabel: strings.common.shuffleAll,
              disabled: detail === undefined || detail.tracks.length === 0,
              onPress: shuffleAll,
            }}
            play={{
              testID: 'album-play-all',
              accessibilityLabel: catalogStrings.common.playAll,
              disabled: detail === undefined || detail.tracks.length === 0,
              hasTVPreferredFocus: tv.isTv && isFocused && detail !== undefined && detail.tracks.length > 0 ? true : undefined,
              onPress: playAll,
            }}
          >
            {openArtist !== undefined ? (
              <Pressable
                testID={`album-artist-${catalogTestIdSegment(artistId)}`}
                focusable
                accessibilityRole="button"
                accessibilityLabel={catalogStrings.common.openArtist(artistName)}
                onFocus={() => artistFocusController.setFocused(true)}
                onBlur={() => artistFocusController.setFocused(false)}
                onPress={openArtist}
                style={({ pressed }) => [styles.artistLink, pressed && styles.pressed]}
              >
                <AppText variant="label" numberOfLines={1}>
                  {catalogStrings.album.byArtist(artistName)}
                </AppText>
                <FocusRingOverlay controller={artistFocusController} borderRadius={radii.sm} />
              </Pressable>
            ) : artistName.length > 0 ? (
              <AppText variant="label" numberOfLines={1}>
                {catalogStrings.album.byArtist(artistName)}
              </AppText>
            ) : null}
            {facts.length > 0 || runtimeMinutes !== null ? (
              <AppText variant="callout" color="secondary" numberOfLines={2}>
                {facts.join(' · ')}
                {runtimeMinutes !== null ? (
                  <>
                    {facts.length > 0 ? ' · ' : ''}
                    <AppText testID="album-runtime" variant="callout" color="secondary">
                      {catalogStrings.album.runtime(runtimeMinutes)}
                    </AppText>
                  </>
                ) : null}
              </AppText>
            ) : null}
          </CatalogDetailHero>
        }
        status={
          <>
            <CatalogRuntimeError id="album" message={runtimeError} />
            {detail !== undefined ? (
              <CatalogContentStatus
                id="album"
                hasData
                {...catalogQueryFlags(album)}
                refreshIndicator={false}
                onRetry={refetch}
              />
            ) : null}
          </>
        }
        empty={
          seededInitialLoading ? (
            <TrackRowSkeleton
              testID="album-loading"
              accessibilityLabel={catalogStrings.album.loading}
              count={5}
            />
          ) : detail !== undefined && !albumHasContent(detail) ? (
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
            onPress={() => playTrack(index)}
            onLongPress={() => showTrackActions(track, setRuntimeError)}
            onOpenAlbum={props.onOpenAlbum}
            onOpenArtist={props.onOpenArtist}
          />
        )}
      />
    </TvFocusScope>
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
