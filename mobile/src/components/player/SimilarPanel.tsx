import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Track } from '../../api/types';
import { musicQueries } from '../../data';
import { resolveRemoteVisualState, type RemoteVisualState } from '../../data/remoteState';
import { strings } from '../../localization';
import { playTracks } from '../../player/controller';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors } from '../../theme';
import TrackRow from '../TrackRow';
import { showTrackActions } from '../trackActions';
import { SearchErrorNotice, SearchRemoteBoundary } from '../search/SearchRemoteStates';
import { ownsSimilarSeed, similarPlaybackSelection } from './similarModel';

export interface SimilarPanelProps {
  seed: Track;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

export interface SimilarPanelViewProps {
  seedId: string;
  tracks: readonly Track[];
  state: RemoteVisualState;
  retryBusy: boolean;
  runtimeError: string | null;
  onRetry: () => void;
  onPlay: (index: number) => void;
  onActions: (track: Track) => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

/** Stateless view exported so every state and row action can be tested without network/player hooks. */
export function SimilarPanelView({
  seedId,
  tracks,
  state,
  retryBusy,
  runtimeError,
  onRetry,
  onPlay,
  onActions,
  onOpenAlbum,
  onOpenArtist,
}: SimilarPanelViewProps) {
  const data = [...tracks];
  const renderItem = ({ item, index }: ListRenderItemInfo<Track>) => (
    <TrackRow
      track={item}
      testID={`similar-track-${seedId}-${item.id}-${index}`}
      occurrence={{
        queueContext: { type: 'radio', id: `similar:${seedId}` },
        originalContextOrder: index,
      }}
      onPress={() => onPlay(index)}
      onLongPress={() => onActions(item)}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );

  return (
    <View testID="similar-panel" style={styles.container}>
      <Text accessibilityRole="header" style={styles.heading}>
        {strings.player.similar.title}
      </Text>
      {runtimeError !== null ? (
        <SearchErrorNotice
          testID="similar-runtime-error"
          message={runtimeError}
        />
      ) : null}
      <SearchRemoteBoundary
        id="similar"
        state={state}
        loadingLabel={strings.player.similar.loading}
        emptyLabel={strings.player.similar.empty}
        offlineLabel={strings.player.similar.offline}
        errorLabel={strings.player.similar.loadFailed}
        cachedOfflineLabel={strings.player.similar.cachedOffline}
        cachedErrorLabel={strings.player.similar.cachedRefreshFailed}
        refreshingLabel={strings.player.similar.refreshing}
        staleLabel={strings.player.similar.stale}
        retryLabel={strings.player.similar.retry}
        retryBusy={retryBusy}
        onRetry={onRetry}
      >
        <FlatList
          testID="similar-list"
          data={data}
          style={styles.virtualList}
          keyExtractor={(track, index) => `${seedId}:${track.id}:${index}`}
          renderItem={renderItem}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={40}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={styles.list}
        />
      </SearchRemoteBoundary>
    </View>
  );
}

function SimilarPanelQuery({ seed, onOpenAlbum, onOpenArtist }: SimilarPanelProps) {
  const query = useQuery(musicQueries.similarTracks(seed.id));
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const ownerSeedId = useRef(seed.id);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Never publish placeholder rows owned by the previous seed. Cached rows for
  // this exact query key remain valid last-good data during a refresh failure.
  const hasData = query.data !== undefined && !query.isPlaceholderData;
  const tracks = hasData ? query.data : [];
  const state = resolveRemoteVisualState({
    hasData,
    empty: hasData && tracks.length === 0,
    pending: query.isPending,
    fetching: query.isFetching,
    stale: query.isStale,
    fetchStatus: query.fetchStatus,
    error: query.error,
  });

  const play = (index: number) => {
    const renderedSeedId = seed.id;
    if (!ownsSimilarSeed(renderedSeedId, ownerSeedId.current)) return;

    let selection: ReturnType<typeof similarPlaybackSelection>;
    try {
      selection = similarPlaybackSelection(
        seed,
        tracks,
        index,
        strings.player.similar.context(seed.title),
      );
    } catch {
      setRuntimeError(strings.player.similar.playFailed);
      return;
    }

    setRuntimeError(null);
    void playTracks(selection.tracks, selection.startIndex, selection.options)
      .then(() => {
        if (!mounted.current || !ownsSimilarSeed(renderedSeedId, ownerSeedId.current)) return;
        AccessibilityInfo.announceForAccessibility(
          strings.player.similar.started(selection.tracks[selection.startIndex].title),
        );
      })
      .catch(() => {
        if (!mounted.current || !ownsSimilarSeed(renderedSeedId, ownerSeedId.current)) return;
        setRuntimeError(strings.player.similar.playFailed);
      });
  };

  const actions = (track: Track) => {
    const renderedSeedId = seed.id;
    if (!ownsSimilarSeed(renderedSeedId, ownerSeedId.current)) return;
    showTrackActions(track, () => {
      if (mounted.current && ownsSimilarSeed(renderedSeedId, ownerSeedId.current)) {
        setRuntimeError(strings.player.similar.actionFailed);
      }
    });
  };

  return (
    <SimilarPanelView
      seedId={seed.id}
      tracks={tracks}
      state={state}
      retryBusy={query.fetchStatus === 'fetching'}
      runtimeError={runtimeError}
      onRetry={() => void query.refetch()}
      onPlay={play}
      onActions={actions}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

/**
 * Query-backed production Similar surface. The key forces local errors and
 * async ownership to reset atomically when Now Playing changes tracks.
 */
export default function SimilarPanel(props: SimilarPanelProps) {
  return <SimilarPanelQuery key={props.seed.id} {...props} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, paddingTop: 12 },
  heading: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  virtualList: { flex: 1, minHeight: 0 },
  list: { paddingBottom: 24 },
});
