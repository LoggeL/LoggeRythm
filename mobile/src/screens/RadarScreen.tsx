import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import type { ReleaseRadarEntry } from '../api/types';
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
  releaseRadarTracks,
  unseenReleaseRadarTrackIds,
} from '../data';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { TvFocusScope, useTvEnvironment, useTvFocusReturn } from '../tv';
import { catalogFailureMessage } from './catalogFeedback';
import {
  assertTrackCatalogRouteCallbacks,
  trackContextKey,
  type TrackCatalogRouteCallbacks,
} from './catalogModel';
import { catalogStrings } from './catalogStrings';
import {
  formatRadarReason,
  formatRadarReleaseDate,
  homeQueueContext,
  joinRadarFacts,
} from './homeModel';
import { useCatalogPlayback } from './useCatalogPlayback';

const EMPTY_ENTRIES: ReleaseRadarEntry[] = [];

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
  const isFocused = useIsFocused();
  const bottomInset = useBottomInset();
  const tv = useTvEnvironment();
  useTvFocusReturn({ scope: 'radar', active: isFocused, enabled: tv.isTv });
  const radar = useQuery(musicQueries.releaseRadarEntries(scope));
  const entries = radar.data ?? EMPTY_ENTRIES;
  // Playback, the queue and the seen-state work on the plain tracks, as before.
  const tracks = useMemo(() => releaseRadarTracks(entries), [entries]);
  const trackIds = useMemo(() => releaseRadarTrackIds(tracks), [tracks]);
  const { runtimeError, setRuntimeError, play, playRow } = useCatalogPlayback();
  const { newTrackIds, seenStateError } = useNewRadarTracks(scope, trackIds);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const refetch = useCallback(() => void radar.refetch(), [radar]);
  const pullToRefresh = useCallback(() => {
    setManualRefreshing(true);
    void radar.refetch().finally(() => setManualRefreshing(false));
  }, [radar]);

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

  const context = homeQueueContext({ kind: 'release-radar', label: strings.home.releaseRadar });
  const cover = tracks.find((track) => track.cover)?.cover ?? '';
  const now = new Date();
  const trackCount = strings.common.trackCount(tracks.length);

  return (
    <TvFocusScope scope="radar">
      <CatalogCollectionPage
        id="release-radar"
        tracks={tracks}
        refreshing={manualRefreshing}
        refreshAccessibilityLabel={catalogStrings.common.refreshing}
        onRefresh={pullToRefresh}
        tv={tv}
        bottomInset={bottomInset}
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
              hasTVPreferredFocus: tv.isTv && isFocused && tracks.length > 0 ? true : undefined,
              onPress: () => play(tracks, 0, context),
            }}
          >
            <AppText variant="callout" color="secondary" numberOfLines={3}>
              {strings.home.radarRule}
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
                label={radar.isFetching ? catalogStrings.common.refreshingNow : catalogStrings.common.refresh}
                busy={radar.isFetching}
                onRetry={refetch}
              />
            }
          />
        }
        renderTrack={(track, index) => {
          const entry = entries[index];
          if (entry === undefined || entry.track !== track) {
            throw new Error(
              `Release Radar row ${index} (track ${String(track.id)}) has no matching radar entry`,
            );
          }
          const date = formatRadarReleaseDate(
            track.release_date,
            now,
            strings.home.radarRelativeDate,
          );
          const isNew = newTrackIds.has(String(track.id));
          const lead = [isNew ? strings.home.radarNewTrack : '', date];
          return (
            <CatalogTrackRow
              track={track}
              index={index}
              testID={`release-radar-track-${trackContextKey(track, index)}`}
              occurrence={{
                queueContext: { type: 'home', id: 'release-radar' },
                originalContextOrder: index,
              }}
              metadata={joinRadarFacts(
                [...lead, formatRadarReason(entry, strings.home.radarReason, 'row')],
                ' · ',
              )}
              metadataAccessibilityLabel={joinRadarFacts(
                [...lead, formatRadarReason(entry, strings.home.radarReasonSpoken, 'spoken')],
                ', ',
              )}
              highlighted={isNew}
              onPress={() => playRow(tracks, index, context)}
              onLongPress={() => showTrackActions(track, setRuntimeError)}
              onOpenAlbum={props.onOpenAlbum}
              onOpenArtist={props.onOpenArtist}
            />
          );
        }}
      />
    </TvFocusScope>
  );
}
