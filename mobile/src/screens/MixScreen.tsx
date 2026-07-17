import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
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
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries } from '../data';
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
import { findHomeMix, type HomeMixRouteParams } from './homeModel';

export type MixScreenProps = HomeMixRouteParams & TrackCatalogRouteCallbacks;

export default function MixScreen(props: MixScreenProps) {
  assertTrackCatalogRouteCallbacks(props, 'MixScreen');
  const routeMixKey = props.mixKey;
  const { user } = useAuth();
  if (user === null) throw new Error('MixScreen requires an authenticated user');

  const mixKey = typeof routeMixKey === 'string' ? routeMixKey.trim() : '';
  const validRoute = mixKey.length > 0;
  const scope = musicCacheScope(getCurrentApiBase(), user.id);
  const mixes = useQuery({
    ...musicQueries.homeMixes(scope),
    enabled: validRoute,
  });
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  if (!validRoute) {
    return (
      <View testID="mix-invalid" accessibilityRole="alert" style={styles.pageState}>
        <Text style={styles.errorText}>{strings.home.mixNotFound}</Text>
      </View>
    );
  }

  if (mixes.data === undefined) {
    return (
      <CatalogPageGate
        id="mix"
        hasData={false}
        isPending={mixes.isPending}
        isFetching={mixes.isFetching}
        isStale={mixes.isStale}
        fetchStatus={mixes.fetchStatus}
        error={mixes.error}
        loadingLabel={strings.home.sectionLoading(strings.home.mixes)}
        onRetry={() => void mixes.refetch()}
      />
    );
  }

  const queryStatus = (
    <CatalogContentStatus
      id="mix"
      hasData
      isPending={mixes.isPending}
      isFetching={mixes.isFetching}
      isStale={mixes.isStale}
      fetchStatus={mixes.fetchStatus}
      error={mixes.error}
      onRetry={() => void mixes.refetch()}
    />
  );
  const mix = findHomeMix(mixes.data, mixKey);
  if (mix === null) {
    return (
      <View testID="mix-not-found" style={styles.container}>
        {queryStatus}
        <View style={styles.pageState}>
          <Text accessibilityLiveRegion="polite" style={styles.empty}>
            {strings.home.mixNotFound}
          </Text>
          <CatalogActionButton
            testID="mix-not-found-retry"
            label={strings.common.retry}
            onPress={() => void mixes.refetch()}
          />
        </View>
      </View>
    );
  }

  const play = (index: number) => {
    let selected: ReturnType<typeof playbackSelection>;
    try {
      selected = playbackSelection(mix.tracks, index);
    } catch (error) {
      setRuntimeError(catalogFailureMessage('home-playback', error));
      return;
    }
    setRuntimeError(null);
    void playTracks(selected.tracks, selected.startIndex, {
      context: { type: 'home', id: `mix:${mix.key}`, label: mix.title },
    }).catch((error) =>
      setRuntimeError(catalogFailureMessage('home-playback', error)),
    );
  };

  const refreshing = mixes.isFetching && !mixes.isPending;
  return (
    <View testID="mix-screen" style={styles.container}>
      <CatalogTrackList
        id="mix"
        tracks={mix.tracks}
        refreshing={refreshing}
        refreshAccessibilityLabel={strings.home.sectionRefreshing}
        onRefresh={() => void mixes.refetch()}
        header={
          <View style={styles.headerContent}>
            <View style={styles.hero}>
              <CatalogHeroArtwork uri={mix.cover} />
              <Text style={styles.typeLabel}>{strings.navigation.playlists}</Text>
              <Text testID="mix-title" accessibilityRole="header" style={styles.title}>
                {mix.title}
              </Text>
              {mix.subtitle.trim().length > 0 ? (
                <Text style={styles.subtitle}>{mix.subtitle}</Text>
              ) : null}
              <Text style={styles.meta}>{strings.common.trackCount(mix.tracks.length)}</Text>
              <CatalogActionButton
                testID="mix-play-all"
                label={strings.common.play}
                disabled={mix.tracks.length === 0}
                onPress={() => play(0)}
              />
            </View>

            <CatalogRuntimeError id="mix" message={runtimeError} />
            {queryStatus}
            {mix.tracks.length > 0 ? <View testID="mix-track-list" /> : null}
          </View>
        }
        empty={
          <Text testID="mix-empty" style={styles.empty}>
            {strings.home.sectionEmpty(mix.title)}
          </Text>
        }
        renderTrack={(track, index) => (
          <CatalogTrackRow
            track={track}
            index={index}
            testID={`mix-track-${trackContextKey(track, index)}`}
            occurrence={{
              queueContext: { type: 'home', id: `mix:${mix.key}` },
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
  pageState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
    backgroundColor: colors.background,
  },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
