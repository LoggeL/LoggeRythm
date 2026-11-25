import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { presentError, type UserFacingError } from '../auth/presentationError';
import { strings } from '../localization';
import { initializeOfflineDownloads } from '../offline/runtime';
import { cancelBrowseTreePublication, refreshBrowseTree } from '../player/browseTree';
import { reportPlayerNotice } from '../player/notices';
import { hydrateAccountPlaybackSettings } from '../player/playbackSettingsSync';
import { ensurePlayer } from '../player/setup';

export interface PlayerBootstrap {
  /** The native MediaController is connected; the navigator may mount. */
  ready: boolean;
  /** Startup failed. The gate must show it; nothing continues without a player. */
  error: UserFacingError | null;
  /** Clears the error and runs the whole startup sequence again. */
  retry: () => void;
}

/**
 * Starts the playback stack for one account after the first interactions:
 * offline downloads, then the native player. Any failure there is surfaced
 * as `error` (the app does not continue without a player). The Android Auto
 * browse tree is refreshed afterwards; its failure is reported as a visible
 * player notice because playback itself still works.
 */
export function usePlayerBootstrap(accountScope: string): PlayerBootstrap {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!mounted) return;
      void initializeOfflineDownloads(accountScope)
        .then(() => {
          if (!mounted) return undefined;
          return ensurePlayer(accountScope);
        })
        .then(() => {
          if (!mounted) return;
          setReady(true);
          void hydrateAccountPlaybackSettings(accountScope, () => mounted).catch(
            (settingsError: unknown) => {
              if (!mounted) return;
              console.error(
                '[LoggeRythm] Failed to hydrate account playback settings on startup:',
                settingsError,
              );
            },
          );
          void refreshBrowseTree()
            .then(() => {
              if (mounted) console.info('[LoggeRythm] Android Auto library ready');
            })
            .catch(() => {
              if (!mounted) return;
              reportPlayerNotice(
                'bookkeeping',
                'auto-library-refresh',
                strings.player.autoLibraryFailed,
                strings.player.autoLibraryRefreshFailedMessage,
              );
            });
        })
        .catch((cause) => {
          if (mounted) setError(presentError(cause, strings.player.startFailedMessage));
        });
    });
    return () => {
      mounted = false;
      task.cancel();
      cancelBrowseTreePublication();
    };
  }, [accountScope, attempt]);

  const retry = () => {
    setReady(false);
    setError(null);
    setAttempt((value) => value + 1);
  };

  return { ready, error, retry };
}
