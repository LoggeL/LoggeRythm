import { useState } from 'react';
import type { Track } from '../api/types';
import { playTracks, type PlayTracksOptions } from '../player/controller';
import { catalogFailureMessage, type CatalogFailureKind } from './catalogFeedback';
import { playbackSelection } from './catalogModel';

export interface CatalogPlayback {
  /** The user-facing message of the last failed playback or track action, or null. */
  runtimeError: string | null;
  /** For sibling actions on the same page (track menu, follow) that share the banner. */
  setRuntimeError: (message: string | null) => void;
  /** Starts `tracks` at `index` in `context`. Failures land in `runtimeError`. */
  play: (tracks: Track[], index: number, context: PlayTracksOptions['context']) => void;
}

/**
 * The playback boilerplate every catalog detail page repeats: validate the
 * selection, clear the previous failure, start the queue and surface a
 * rejected start as one sanitized message. Nothing is swallowed — both the
 * synchronous selection error and the asynchronous player rejection end in
 * `runtimeError`, which the page renders with `CatalogRuntimeError`.
 *
 * It owns exactly one `useState`, so a screen whose test pins hook order
 * (MixScreen) keeps the same sequence as when the state lived inline.
 */
export function useCatalogPlayback(
  failureKind: Extract<CatalogFailureKind, 'playback' | 'home-playback'> = 'playback',
): CatalogPlayback {
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const play: CatalogPlayback['play'] = (tracks, index, context) => {
    let selected: ReturnType<typeof playbackSelection>;
    try {
      selected = playbackSelection(tracks, index);
    } catch (error) {
      setRuntimeError(catalogFailureMessage(failureKind, error));
      return;
    }
    setRuntimeError(null);
    void playTracks(selected.tracks, selected.startIndex, { context }).catch((error) =>
      setRuntimeError(catalogFailureMessage(failureKind, error)),
    );
  };
  return { runtimeError, setRuntimeError, play };
}
