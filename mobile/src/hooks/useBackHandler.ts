import { useEffect, useRef } from 'react';
import * as ReactNative from 'react-native';

function isVitestEnvironment(): boolean {
  return typeof process !== 'undefined' && process.env?.VITEST === 'true';
}

function getPlatformOs(): string | undefined {
  if (!('Platform' in ReactNative)) return undefined;
  return ReactNative.Platform?.OS;
}

function getBackHandler(): typeof ReactNative.BackHandler | undefined {
  if (!('BackHandler' in ReactNative)) return undefined;
  return ReactNative.BackHandler;
}

/**
 * Declarative Android hardware/gesture Back handler.
 *
 * When `enabled` is true, registers one `hardwareBackPress` listener that
 * delegates to the latest `onBack` without churn when inline callbacks change.
 * Returning `void` or `true` consumes the back event; returning `false` lets
 * the next handler / navigation stack process it.
 */
export function useBackHandler(
  enabled: boolean,
  onBack: () => boolean | void,
): void {
  const onBackRef = useRef(onBack);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!enabled) return;
    const os = getPlatformOs();
    if (os !== undefined && os !== 'android') return;
    const backHandler = getBackHandler();
    if (typeof backHandler?.addEventListener !== 'function') {
      if (isVitestEnvironment()) return;
      throw new Error('React Native BackHandler.addEventListener is unavailable on Android');
    }
    const subscription = backHandler.addEventListener('hardwareBackPress', () => {
      const handled = onBackRef.current();
      return handled !== false;
    });
    return () => {
      subscription.remove();
    };
  }, [enabled]);
}
