import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { InitialState, NavigationState } from '@react-navigation/native';
import {
  persistNavigationState,
  readNavigationStateUnlessLinked,
} from '../navigationPersistence';

export interface NavigationRestoration {
  /** The stored state for this account has been read (or found unusable). */
  ready: boolean;
  /** State to hand to NavigationContainer; undefined starts at the default route. */
  initialState: InitialState | undefined;
  /** Persist the latest navigation state for this account. */
  persist: (state: NavigationState | undefined) => void;
}

/**
 * Per-account navigation state persistence. Reads the stored state once per
 * account scope (skipped when the app was opened through a link) and exposes
 * `persist` for NavigationContainer.onStateChange. Restoration is a
 * convenience: an unreadable snapshot is logged and the app starts at its
 * default route instead of blocking startup.
 */
export function useNavigationRestoration(accountScope: string): NavigationRestoration {
  const [restoration, setRestoration] = useState<{
    scope: string | null;
    ready: boolean;
    state: InitialState | undefined;
  }>({ scope: null, ready: false, state: undefined });

  useEffect(() => {
    let active = true;
    void readNavigationStateUnlessLinked(
      AsyncStorage,
      accountScope,
      () => Linking.getInitialURL(),
    )
      .then((state) => {
        if (active) {
          setRestoration({ scope: accountScope, ready: true, state: state ?? undefined });
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          console.error('[LoggeRythm] navigation restoration failed', cause);
          setRestoration({ scope: accountScope, ready: true, state: undefined });
        }
      });
    return () => {
      active = false;
    };
  }, [accountScope]);

  const persist = (state: NavigationState | undefined) => {
    if (state === undefined) return;
    void persistNavigationState(AsyncStorage, accountScope, state).catch((cause: unknown) => {
      console.error('[LoggeRythm] navigation persistence failed', cause);
    });
  };

  return {
    ready: restoration.scope === accountScope && restoration.ready,
    initialState: restoration.state,
    persist,
  };
}
