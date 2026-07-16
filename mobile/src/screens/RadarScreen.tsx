import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Track } from '../api/types';
import {
  CatalogActionButton,
  CatalogHeroArtwork,
  CatalogTrackRow,
} from '../components/catalog/CatalogCards';
import { CatalogTrackList } from '../components/catalog/CatalogTrackList';
import {
  CatalogContentStatus,
  CatalogPageGate,
  CatalogRuntimeError,
} from '../components/catalog/CatalogStates';
import { showTrackActions } from '../components/trackActions';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_API_BASE, normalizeApiBase } from '../config';
import {
  markReleaseRadarTracksSeen,
  musicCacheScope,
  musicQueries,
  releaseRadarTrackIds,
} from '../data';
import { strings } from '../localization';
import { playTracks } from '../player/controller';
import { colors } from '../theme';
import { catalogFailureMessage } from './catalogFeedback';
import {
  assertTrackCatalogRouteCallbacks,
  playbackSelection,
  trackContextKey,
  type TrackCatalogRouteCallbacks,
} from './catalogModel';
import { catalogStrings } from './catalogStrings';
import { formatRadarReleaseDate, homeQueueContext } from './homeModel';

const EMPTY_TRACKS: Track[] = [];

export type RadarScreenProps = TrackCatalogRouteCallbacks;

export default function RadarScreen(props: RadarScreenProps) {
  assertTrackCatalogRouteCallbacks(props, 'RadarScreen');
  const { user } = useAuth();
  if (user === null) throw new Error('RadarScreen requires an authenticated user');

  const scope = musicCacheScope(normalizeApiBase(DEFAULT_API_BASE), user.id);
  const radar = useQuery(musicQueries.releaseRadar(scope));
  const tracks = radar.data ?? EMPTY_TRACKS;
  const trackIds = useMemo(() => releaseRadarTrackIds(tracks), [tracks]);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [seenStateError, setSeenStateError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (trackIds.length === 0) return () => { active = false; };
    void markReleaseRadarTracksSeen(AsyncStorage, scope, trackIds)
      .then(() => {
        if (active) setSeenStateError(null);
      })
      .catch((error) => {
        if (!active) return;
        setSeenStateError(catalogFailureMessage('radar-seen-state', error));
      });
    return () => { active = false; };
  }, [scope, trackIds]);

  if (radar.data === undefined) {
    return (
      <CatalogPageGate
        id="release-radar"
        hasData={false}
        isPending={radar.isPending}
        isFetching={radar.isFetching}
        isStale={radar.isStale}
        fetchStatus={radar.fetchStatus}
        error={radar.error}
        loadingLabel={strings.home.sectionLoading(strings.home.releaseRadar)}
        onRetry={() => void radar.refetch()}
      />
    );
  }

  const play = (index: number) => {
    let selected: ReturnType<typeof playbackSelection>;
    try {
      selected = playbackSelection(tracks, index);
    } catch (error) {
      setPlaybackError(catalogFailureMessage('home-playback', error));
      return;
    }
    setPlaybackError(null);
    void playTracks(selected.tracks, selected.startIndex, {
      context: homeQueueContext({
        kind: 'release-radar',
        label: strings.home.releaseRadar,
      }),
    }).catch((error) =>
      setPlaybackError(catalogFailureMessage('home-playback', error)),
    );
  };

  const cover = tracks.find((track) => track.cover)?.cover ?? '';
  const now = new Date();
  return (
    <View testID="release-radar-screen" style={styles.container}>
      <CatalogTrackList
        id="release-radar"
        tracks={tracks}
        refreshing={radar.isFetching && !radar.isPending}
        refreshAccessibilityLabel={catalogStrings.common.refreshing}
        onRefresh={() => void radar.refetch()}
        header={
          <View style={styles.headerContent}>
            <View style={styles.hero}>
              <CatalogHeroArtwork uri={cover} />
              <Text style={styles.typeLabel}>{strings.home.radarTypeLabel}</Text>
              <Text testID="release-radar-title" accessibilityRole="header" style={styles.title}>
                {strings.home.releaseRadar}
              </Text>
              <Text style={styles.subtitle}>{strings.home.radarSubtitle}</Text>
              <Text style={styles.meta}>{strings.common.trackCount(tracks.length)}</Text>
              <CatalogActionButton
                testID="release-radar-play-all"
                label={catalogStrings.common.playAll}
                disabled={tracks.length === 0}
                onPress={() => play(0)}
              />
            </View>

            <CatalogRuntimeError id="release-radar-playback" message={playbackError} />
            <CatalogRuntimeError
              id="release-radar-seen-state"
              message={trackIds.length > 0 ? seenStateError : null}
            />
            <CatalogContentStatus
              id="release-radar"
              hasData
              isPending={radar.isPending}
              isFetching={radar.isFetching}
              isStale={radar.isStale}
              fetchStatus={radar.fetchStatus}
              error={radar.error}
              onRetry={() => void radar.refetch()}
            />
            {tracks.length > 0 ? <View testID="release-radar-track-list" /> : null}
          </View>
        }
        empty={
          <Text testID="release-radar-empty" style={styles.empty}>
            {strings.home.radarEmpty}
          </Text>
        }
        renderTrack={(track, index) => {
          const date = formatRadarReleaseDate(
            track.release_date,
            now,
            strings.home.radarRelativeDate,
          );
          return (
            <CatalogTrackRow
              track={track}
              index={index}
              testID={`release-radar-track-${trackContextKey(track, index)}`}
              occurrence={{
                queueContext: { type: 'home', id: 'release-radar' },
                originalContextOrder: index,
              }}
              metadata={date || undefined}
              onPress={() => play(index)}
              onLongPress={() => showTrackActions(track, setPlaybackError)}
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
  headerContent: { gap: 24, paddingTop: 22 },
  hero: { alignItems: 'center', gap: 10, paddingHorizontal: 20 },
  typeLabel: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  meta: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  empty: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, paddingHorizontal: 16 },
});
