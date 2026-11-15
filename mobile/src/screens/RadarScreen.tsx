import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Track } from '../api/types';
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
import { AppText, EmptyState, RetryButton } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { getCurrentApiBase } from '../config';
import {
  markReleaseRadarTracksSeen,
  musicCacheScope,
  musicQueries,
  readReleaseRadarSeenTrackIds,
  releaseRadarTrackIds,
  unseenReleaseRadarTrackIds,
} from '../data';
import { strings } from '../localization';
import { catalogFailureMessage } from './catalogFeedback';
import {
  assertTrackCatalogRouteCallbacks,
  trackContextKey,
  type TrackCatalogRouteCallbacks,
} from './catalogModel';
import { catalogStrings } from './catalogStrings';
import { formatRadarReleaseDate, homeQueueContext } from './homeModel';
import { useCatalogPlayback } from './useCatalogPlayback';

const EMPTY_TRACKS: Track[] = [];

export type RadarScreenProps = TrackCatalogRouteCallbacks;

/**
 * Which radar tracks are new since the last visit. Reading marks them seen,
 * so the set only ever grows during one visit: a refresh must not wipe the
 * highlights the user is still looking at. A storage failure is reported,
 * never hidden.
 */
function useNewRadarTracks(scope: string, trackIds: readonly string[]) {
  const [newTrackIds, setNewTrackIds] = useState<ReadonlySet<string>>(new Set());
  const [seenStateError, setSeenStateError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (trackIds.length === 0) return () => { active = false; };
    void readReleaseRadarSeenTrackIds(AsyncStorage, scope)
      .then((seenIds) => {
        if (!active) return [];
        setNewTrackIds((prev) => {
          const merged = new Set(prev);
          for (const id of unseenReleaseRadarTrackIds(trackIds, seenIds)) {
            merged.add(id);
          }
          return merged;
        });
        return markReleaseRadarTracksSeen(AsyncStorage, scope, trackIds);
      })
      .then(() => {
        if (active) setSeenStateError(null);
      })
      .catch((error) => {
        if (!active) return;
        setSeenStateError(catalogFailureMessage('radar-seen-state', error));
      });
    return () => { active = false; };
  }, [scope, trackIds]);

  return { newTrackIds, seenStateError: trackIds.length > 0 ? seenStateError : null };
}

export default function RadarScreen(props: RadarScreenProps) {
  assertTrackCatalogRouteCallbacks(props, 'RadarScreen');
  const { user } = useAuth();
  if (user === null) throw new Error('RadarScreen requires an authenticated user');

  const scope = musicCacheScope(getCurrentApiBase(), user.id);
  const radar = useQuery(musicQueries.releaseRadar(scope));
  const tracks = radar.data ?? EMPTY_TRACKS;
  const trackIds = useMemo(() => releaseRadarTrackIds(tracks), [tracks]);
  const { runtimeError, setRuntimeError, play } = useCatalogPlayback('home-playback');
  const { newTrackIds, seenStateError } = useNewRadarTracks(scope, trackIds);
  const refetch = () => void radar.refetch();

  if (radar.data === undefined) {
    return (
      <CatalogPageGate
        id="release-radar"
        hasData={false}
        {...catalogQueryFlags(radar)}
        loadingLabel={strings.home.sectionLoading(strings.home.releaseRadar)}
        onRetry={refetch}
      />
    );
  }

  const playFrom = (index: number) =>
    play(
      tracks,
      index,
      homeQueueContext({ kind: 'release-radar', label: strings.home.releaseRadar }),
    );
  const refreshing = radar.isFetching && !radar.isPending;
  const cover = tracks.find((track) => track.cover)?.cover ?? '';
  const now = new Date();
  const trackCount = strings.common.trackCount(tracks.length);

  return (
    <CatalogCollectionPage
      id="release-radar"
      tracks={tracks}
      refreshing={refreshing}
      refreshAccessibilityLabel={catalogStrings.common.refreshing}
      onRefresh={refetch}
      hero={
        <CatalogDetailHero
          artwork={<CatalogHeroArtwork uri={cover} />}
          eyebrow={strings.home.radarTypeLabel}
          title={strings.home.releaseRadar}
          titleTestID="release-radar-title"
          play={{
            testID: 'release-radar-play-all',
            accessibilityLabel: catalogStrings.common.playAll,
            disabled: tracks.length === 0,
            onPress: () => playFrom(0),
          }}
        >
          <AppText variant="callout" color="secondary" numberOfLines={3}>
            {strings.home.radarSubtitle}
          </AppText>
          <AppText variant="caption" color="muted">
            {newTrackIds.size > 0
              ? `${trackCount} · ${strings.home.radarNewCount(newTrackIds.size)}`
              : trackCount}
          </AppText>
        </CatalogDetailHero>
      }
      status={
        <>
          <CatalogRuntimeError id="release-radar-playback" message={runtimeError} />
          <CatalogRuntimeError id="release-radar-seen-state" message={seenStateError} />
          <CatalogContentStatus
            id="release-radar"
            hasData
            {...catalogQueryFlags(radar)}
            refreshIndicator={false}
            onRetry={refetch}
          />
        </>
      }
      empty={
        <EmptyState
          testID="release-radar-empty"
          icon="radar"
          title={strings.home.radarEmptyTitle}
          message={strings.home.radarEmpty}
          action={
            <RetryButton
              testID="release-radar-empty-refresh"
              label={refreshing ? catalogStrings.common.refreshingNow : catalogStrings.common.refresh}
              busy={refreshing}
              onRetry={refetch}
            />
          }
        />
      }
      renderTrack={(track, index) => {
        const date = formatRadarReleaseDate(
          track.release_date,
          now,
          strings.home.radarRelativeDate,
        );
        const isNew = newTrackIds.has(String(track.id));
        return (
          <CatalogTrackRow
            track={track}
            index={index}
            testID={`release-radar-track-${trackContextKey(track, index)}`}
            occurrence={{
              queueContext: { type: 'home', id: 'release-radar' },
              originalContextOrder: index,
            }}
            metadata={isNew
              ? `${strings.home.radarNewTrack}${date ? ` · ${date}` : ''}`
              : date || undefined}
            highlighted={isNew}
            onPress={() => playFrom(index)}
            onLongPress={() => showTrackActions(track, setRuntimeError)}
            onOpenAlbum={props.onOpenAlbum}
            onOpenArtist={props.onOpenArtist}
          />
        );
      }}
    />
  );
}
