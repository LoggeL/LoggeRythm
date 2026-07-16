import { NativeEventEmitter, NativeModules, Platform, type EmitterSubscription } from 'react-native';

interface SharedTextIntentNativeModule {
  consumeSharedText(): Promise<string | null>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const EVENT_NAME = 'SharedTextReceived';

function nativeModule(): SharedTextIntentNativeModule | null {
  if (Platform.OS !== 'android') return null;
  const candidate = NativeModules.SharedTextIntent as SharedTextIntentNativeModule | undefined;
  return candidate ?? null;
}

/**
 * Subscribe before draining the launch intent, closing the cold-start race.
 * Missing native code (Expo Go, iOS, tests) is an honest no-op.
 */
export function startSharedTextIntake(onText: (text: string) => void): () => void {
  const module = nativeModule();
  if (module === null) return () => undefined;

  let active = true;
  let subscription: EmitterSubscription | null = null;
  try {
    subscription = new NativeEventEmitter(module).addListener(EVENT_NAME, (value: unknown) => {
      if (active && typeof value === 'string') onText(value);
    });
  } catch {
    // A broken optional bridge must not prevent the app from launching. Manual
    // paste remains available and the missing bridge is covered by native QA.
  }
  void module.consumeSharedText()
    .then((value) => {
      if (active && typeof value === 'string') onText(value);
    })
    .catch(() => {
      // Shared text contains no credentials and is intentionally not logged.
    });

  return () => {
    active = false;
    subscription?.remove();
  };
}
