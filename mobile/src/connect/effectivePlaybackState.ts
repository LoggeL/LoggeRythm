import { useEffect, useState } from 'react';
import type { ConnectDevice, ConnectPlaybackState, Track } from '../api/types';
import { mediaItemToTrack } from '../player/mediaItem';
import {
  PlaybackState,
  RepeatMode,
  useActiveMediaItem,
  useHasActiveTrack,
  useIsPlaying,
  usePlaybackState,
  useProgress,
} from '../player/player';
import { useActiveConnectSnapshot } from './activeConnect';
import {
  activeRemoteTrack,
  connectRepeatToPlayer,
  extrapolatedConnectPosition,
} from './connectModel';

export interface EffectivePlaybackState {
  readonly mode: 'local' | 'remote';
  readonly track: Track | null;
  readonly playing: boolean;
  readonly buffering: boolean;
  readonly contextLabel: string | null;
  readonly activeDevice: ConnectDevice | null;
  readonly remotePlayback: ConnectPlaybackState | null;
  readonly repeatMode: RepeatMode | null;
  readonly shuffle: boolean | null;
}

/**
 * Unified read-only playback state across local native playback and Spotify
 * Connect remote playback. Kept free of `player/controller` imports so light
 * chrome hooks (`useBottomInset`, `playerOverlays`, `NowPlayingTransport`,
 * `TvShellChrome`) never pull native API/controller modules into unit tests.
 */
export function useEffectivePlayback(): EffectivePlaybackState {
  const localItem = useActiveMediaItem();
  const localPlaying = useIsPlaying();
  const localPlaybackState = usePlaybackState();
  const connect = useActiveConnectSnapshot();

  if (connect.isControllingRemote && connect.state !== null) {
    const playback = connect.state.playback;
    const remoteTrack = activeRemoteTrack(playback);
    if (remoteTrack !== null) {
      return {
        mode: 'remote',
        track: remoteTrack,
        playing: playback.is_playing,
        buffering: false,
        contextLabel: playback.queue_context,
        activeDevice: connect.activeDevice,
        remotePlayback: playback,
        repeatMode: connectRepeatToPlayer(playback.repeat),
        shuffle: playback.shuffle,
      };
    }
  }

  return {
    mode: 'local',
    track: mediaItemToTrack(localItem),
    playing: localPlaying,
    buffering: localPlaybackState === PlaybackState.Buffering,
    contextLabel: null,
    activeDevice: connect.activeDevice,
    remotePlayback: null,
    repeatMode: null,
    shuffle: null,
  };
}

/** True when either local native playback or a controlled remote device has an active track. */
export function useHasEffectiveActiveTrack(): boolean {
  const localActive = useHasActiveTrack();
  const connect = useActiveConnectSnapshot();
  if (localActive) return true;
  if (!connect.isControllingRemote || connect.state === null) return false;
  return activeRemoteTrack(connect.state.playback) !== null;
}

/**
 * Progress for the MiniPlayer / NowPlaying scrubber. Uses native snapshots when
 * local, and client-side playhead extrapolation when controlling a remote device.
 */
export function useEffectiveProgress(updateInterval = 1): { position: number; duration: number } {
  const localProgress = useProgress(updateInterval);
  const connect = useActiveConnectSnapshot();
  const isRemote =
    connect.isControllingRemote
    && connect.state !== null
    && activeRemoteTrack(connect.state.playback) !== null;
  const remotePlayback = isRemote ? connect.state!.playback : null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (remotePlayback === null || !remotePlayback.is_playing) return undefined;
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, Math.max(250, Math.round(updateInterval * 1000)));
    return () => clearInterval(interval);
  }, [remotePlayback, updateInterval]);

  if (remotePlayback === null) {
    return { position: localProgress.position, duration: localProgress.duration };
  }
  const active = activeRemoteTrack(remotePlayback);
  const duration =
    remotePlayback.duration_sec > 0
      ? remotePlayback.duration_sec
      : active?.duration_sec ?? 0;
  return {
    position: extrapolatedConnectPosition(remotePlayback, nowMs),
    duration,
  };
}
