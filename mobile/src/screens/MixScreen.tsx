import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { HomeShelf } from '../api/types';
import { CatalogHeroArtwork, CatalogTrackRow } from '../components/catalog/CatalogCards';
import {
  CatalogCollectionPage,
  type CatalogCollectionPageProps,
} from '../components/catalog/CatalogCollectionPage';
import { CatalogDetailHero } from '../components/catalog/CatalogDetailHero';
import {
  CatalogContentStatus,
  CatalogPageGate,
  CatalogRuntimeError,
} from '../components/catalog/CatalogStates';
import { catalogQueryFlags } from '../components/catalog/catalogQueryState';
import { showTrackActions } from '../components/trackActions';
import { AppText, EmptyState, ErrorState, RetryButton } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries } from '../data';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { colors } from '../theme';
import { TvFocusScope, useTvEnvironment, useTvFocusReturn } from '../tv';
import {
  assertTrackCatalogRouteCallbacks,
  trackContextKey,
  type TrackCatalogRouteCallbacks,
} from './catalogModel';
import { catalogStrings } from './catalogStrings';
import { findHomeMix, type HomeMixRouteParams } from './homeModel';
import { useCatalogPlayback } from './useCatalogPlayback';

export type MixScreenProps = HomeMixRouteParams & TrackCatalogRouteCallbacks;

/**
 * Isolates TV layout/focus hooks in a child boundary so `MixScreen` itself
 * preserves its exact `useAuth -> useQuery -> useState` hook order pinned by
 * `MixScreen.test.tsx`.
 */
export function MixCollectionTvShell(props: Omit<CatalogCollectionPageProps, 'tv' | 'bottomInset'>) {
  const isFocused = useIsFocused();
  const bottomInset = useBottomInset();
  const tv = useTvEnvironment();
  useTvFocusReturn({ scope: 'mix', active: isFocused, enabled: tv.isTv });
  return (
    <TvFocusScope scope="mix">
      <CatalogCollectionPage {...props} tv={tv} bottomInset={bottomInset} />
    </TvFocusScope>
  );
}

const PERSONAL_MIX_KEYS = new Set(['on-repeat', 'forgotten-favorites', 'unheard-cuts']);

export default function MixScreen(props: MixScreenProps) {
  assertTrackCatalogRouteCallbacks(props, 'MixScreen');
  const routeMixKey = props.mixKey;
  const { user } = useAuth();
  if (user === null) throw new Error('MixScreen requires an authenticated user');

  const mixKey = typeof routeMixKey === 'string' ? routeMixKey.trim() : '';
  const validRoute = mixKey.length > 0;
  const scope = musicCacheScope(getCurrentApiBase(), user.id);
  const queryOptions: UseQueryOptions<HomeShelf[], Error> = PERSONAL_MIX_KEYS.has(mixKey)
    ? (musicQueries.personalMixes(scope) as UseQueryOptions<HomeShelf[], Error>)
    : (musicQueries.homeMixes(scope) as UseQueryOptions<HomeShelf[], Error>);
  const mixes = useQuery({
    ...queryOptions,
    enabled: validRoute,
  });
  // Hook order (useAuth → useQuery → one useState inside this hook) is pinned by MixScreen.test.
  const { runtimeError, setRuntimeError, play, playRow } = useCatalogPlayback();
  const refetch = () => void mixes.refetch();

  if (!validRoute) {
    // A malformed route cannot be retried; the stack header's back button is the way out.
    return <ErrorState testID="mix-invalid" layout="page" message={strings.home.mixNotFound} />;
  }

  if (mixes.data === undefined) {
    return (
      <CatalogPageGate
        id="mix"
        hasData={false}
        {...catalogQueryFlags(mixes)}
        loadingLabel={strings.home.sectionLoading(strings.home.mixes)}
        onRetry={refetch}
      />
    );
  }

  const refreshing = mixes.isFetching && !mixes.isPending;
  const mix = findHomeMix(mixes.data, mixKey);
  if (mix === null) {
    return (
      <View testID="mix-not-found" style={styles.container}>
        <CatalogContentStatus id="mix" hasData {...catalogQueryFlags(mixes)} onRetry={refetch} />
        <EmptyState
          layout="page"
          icon="playlist-remove"
          title={strings.home.mixNotFound}
          action={
            <RetryButton testID="mix-not-found-retry" busy={mixes.isFetching} onRetry={refetch} />
          }
        />
      </View>
    );
  }

  const context = { type: 'home' as const, id: `mix:${mix.key}`, label: mix.title };

  return (
    <MixCollectionTvShell
      id="mix"
      tracks={mix.tracks}
      refreshing={refreshing}
      refreshAccessibilityLabel={strings.home.sectionRefreshing}
      onRefresh={refetch}
      hero={
        <CatalogDetailHero
          artwork={<CatalogHeroArtwork uri={mix.cover} />}
          eyebrow={strings.navigation.playlists}
          title={mix.title}
          titleTestID="mix-title"
          play={{
            testID: 'mix-play-all',
            accessibilityLabel: strings.common.play,
            disabled: mix.tracks.length === 0,
            onPress: () => play(mix.tracks, 0, context),
          }}
        >
          {mix.subtitle.trim().length > 0 ? (
            <AppText variant="callout" color="secondary" numberOfLines={3}>
              {mix.subtitle}
            </AppText>
          ) : null}
          <AppText variant="caption" color="muted">
            {strings.common.trackCount(mix.tracks.length)}
          </AppText>
        </CatalogDetailHero>
      }
      status={
        <>
          <CatalogRuntimeError id="mix" message={runtimeError} />
          <CatalogContentStatus
            id="mix"
            hasData
            {...catalogQueryFlags(mixes)}
            refreshIndicator={false}
            onRetry={refetch}
          />
        </>
      }
      empty={
        <EmptyState
          testID="mix-empty"
          icon="playlist-music"
          title={strings.home.sectionEmpty(mix.title)}
          action={
            <RetryButton
              testID="mix-empty-refresh"
              label={refreshing ? catalogStrings.common.refreshingNow : catalogStrings.common.refresh}
              busy={refreshing}
              onRetry={refetch}
            />
          }
        />
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
          onPress={() => playRow(mix.tracks, index, context)}
          onLongPress={() => showTrackActions(track, setRuntimeError)}
          onOpenAlbum={props.onOpenAlbum}
          onOpenArtist={props.onOpenArtist}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
});
