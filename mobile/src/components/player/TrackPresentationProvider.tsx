import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import {
  useActiveMediaItem,
  useIsPlaying,
  usePlaybackState,
  type PlaybackState,
} from '../../player/player';
import { useQuery } from '@tanstack/react-query';
import { musicQueries } from '../../data';
import { useOfflineDownloads } from '../../offline/hooks';
import {
  activeTrackOccurrenceFromMediaItem,
  resolveTrackPresentation,
  type ActiveTrackOccurrence,
  type TrackOccurrenceIdentity,
  type TrackPresentationState,
} from '../../player/trackPresentation';

export interface TrackPresentationOptions {
  /**
   * Optional active-item evidence supplied by a screen that already owns a
   * progress subscription. The provider deliberately does not poll progress.
   */
  rollingDeviceCacheSeconds?: unknown;
}

export interface TrackPresentationContextValue {
  presentationFor: (
    target: TrackOccurrenceIdentity,
    options?: TrackPresentationOptions,
  ) => TrackPresentationState;
}

const TrackPresentationContext = createContext<TrackPresentationContextValue | null>(null);

export function useTrackPresentationResolver(): TrackPresentationContextValue {
  const context = useContext(TrackPresentationContext);
  if (context === null) {
    throw new Error(
      'useTrackPresentationResolver must be used within TrackPresentationProvider',
    );
  }
  return context;
}

export function TrackPresentationProvider({ children }: { children: ReactNode }) {
  // Each native/global source is subscribed exactly once at the provider boundary.
  const activeItem = useActiveMediaItem();
  const isPlaying = useIsPlaying();
  const playbackState = usePlaybackState();
  const cachedTracksQuery = useQuery(musicQueries.cachedTrackIds());
  const offlineDownloads = useOfflineDownloads();

  // Memoize by primitive occurrence & playback identity so 1s progress ticks or
  // non-identity metadata refreshes produce 0 context updates and 0 row re-renders.
  const parsedOccurrence = activeTrackOccurrenceFromMediaItem(activeItem);
  const activeTrackId = parsedOccurrence?.trackId ?? null;
  const activeContextType = parsedOccurrence?.queueContext?.type ?? null;
  const activeContextId = parsedOccurrence?.queueContext?.id ?? null;
  const activeOriginalContextOrder = parsedOccurrence?.originalContextOrder ?? null;
  const isBuffering = activeTrackId !== null && playbackState === 'buffering';
  const activeIsPlaying = activeTrackId !== null && !isBuffering && isPlaying;
  const activePlaybackState: PlaybackState = isBuffering
    ? ('buffering' as PlaybackState)
    : activeTrackId !== null && playbackState === 'ready'
      ? ('ready' as PlaybackState)
      : ('idle' as PlaybackState);

  const activeOccurrence = useMemo<ActiveTrackOccurrence | null>(() => {
    if (activeTrackId === null) return null;
    return {
      trackId: activeTrackId,
      queueContext:
        activeContextType !== null && activeContextId !== null
          ? { type: activeContextType, id: activeContextId }
          : null,
      originalContextOrder: activeOriginalContextOrder,
    };
  }, [
    activeTrackId,
    activeContextType,
    activeContextId,
    activeOriginalContextOrder,
  ]);

  const serverCachedTrackIds = useMemo<ReadonlySet<string> | null>(
    () =>
      cachedTracksQuery.data === undefined
        ? null
        : new Set(cachedTracksQuery.data.ids.map(String)),
    [cachedTracksQuery.data],
  );
  const explicitDownloadedTrackIds = offlineDownloads.hydrated
    ? offlineDownloads.downloadedTrackIds
    : null;

  const presentationFor = useCallback(
    (
      target: TrackOccurrenceIdentity,
      options: TrackPresentationOptions = {},
    ): TrackPresentationState =>
      resolveTrackPresentation({
        target,
        activeOccurrence,
        playbackState: activePlaybackState,
        isPlaying: activeIsPlaying,
        serverCachedTrackIds,
        explicitDownloadedTrackIds,
        rollingDeviceCacheSeconds: options.rollingDeviceCacheSeconds,
      }),
    [
      activeOccurrence,
      activePlaybackState,
      activeIsPlaying,
      explicitDownloadedTrackIds,
      serverCachedTrackIds,
    ],
  );

  const value = useMemo<TrackPresentationContextValue>(
    () => ({ presentationFor }),
    [presentationFor],
  );

  return (
    <TrackPresentationContext.Provider value={value}>
      {children}
    </TrackPresentationContext.Provider>
  );
}

export function useTrackPresentation(
  target: TrackOccurrenceIdentity,
  options?: TrackPresentationOptions,
): TrackPresentationState {
  const context = useContext(TrackPresentationContext);
  if (context === null) {
    throw new Error('useTrackPresentation must be used within TrackPresentationProvider');
  }
  return context.presentationFor(target, options);
}
