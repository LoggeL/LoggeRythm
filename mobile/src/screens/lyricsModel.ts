import type { LyricsLine, LyricsResponse } from '../api/types';
import {
  resolveRemoteVisualState,
  type RemoteBody,
  type RemoteFetchStatus,
  type RemoteNotice,
} from '../data/remoteState';

/** Match the production web player, which advances a line 150 ms early. */
export const LYRIC_ACTIVE_LEAD_SECONDS = 0.15;

export interface LyricsQueryState {
  data: LyricsResponse | undefined;
  error: unknown;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: RemoteFetchStatus;
}

export type LyricsBodyState = RemoteBody;
export type LyricsNoticeState = RemoteNotice;

export interface LyricsVisualState {
  body: LyricsBodyState;
  notice: LyricsNoticeState;
}

export interface LyricsFollowIdentity {
  trackId: string;
  activeIndex: number;
}

export interface LyricsFollowTarget {
  index: number;
  animated: boolean;
}

export type LyricsSourceKind = 'lrclib' | 'loggerythm-ai' | 'external' | null;

/**
 * Return the last lyric line whose timestamp has passed. The server contract
 * orders lines by timestamp; stopping at the first future line mirrors web.
 */
export function activeLyricIndex(
  lines: readonly LyricsLine[],
  positionSeconds: number,
): number {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return -1;
  const threshold = positionSeconds + LYRIC_ACTIVE_LEAD_SECONDS;
  let active = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].t <= threshold) active = index;
    else break;
  }
  return active;
}

/** Keep last-good and known-empty lyrics visible across every remote state. */
export function resolveLyricsVisualState(state: LyricsQueryState): LyricsVisualState {
  const hasResponse = state.data !== undefined;
  const hasLines = (state.data?.lines?.length ?? 0) > 0;
  return resolveRemoteVisualState({
    hasData: hasResponse,
    empty: !hasLines,
    pending: state.isPending,
    fetching: state.isFetching,
    stale: state.isStale,
    fetchStatus: state.fetchStatus,
    error: state.error,
  });
}

/**
 * Decide whether auto-follow should move. A new track is positioned without
 * animation; later lines on the same track move smoothly. Negative indexes
 * deliberately withdraw the old track's target before its first line.
 */
export function lyricsFollowTarget(
  previous: LyricsFollowIdentity | null,
  current: LyricsFollowIdentity,
): LyricsFollowTarget | null {
  if (current.activeIndex < 0) return null;
  if (
    previous?.trackId === current.trackId &&
    previous.activeIndex === current.activeIndex
  ) {
    return null;
  }
  return {
    index: current.activeIndex,
    animated:
      previous?.trackId === current.trackId && previous.activeIndex >= 0,
  };
}

/** Never render an arbitrary backend string as provider/UI diagnostics. */
export function lyricsSourceKind(source: string | null): LyricsSourceKind {
  const normalized = source?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'lrclib') return 'lrclib';
  if (normalized === 'groq' || normalized === 'groq-word-v1') {
    return 'loggerythm-ai';
  }
  return 'external';
}

export function lyricLineKey(line: LyricsLine, index: number): string {
  return `${line.t}:${index}`;
}
