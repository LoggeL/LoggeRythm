import { useSyncExternalStore } from 'react';

let currentError: string | null = null;
const listeners = new Set<() => void>();

/** Explicitly marks already-localized recovery detail as safe for display. */
export class UserFacingPlayerError extends Error {
  override readonly name = 'UserFacingPlayerError';
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function playerFailureMessage(context: string, error: unknown): string {
  return error instanceof UserFacingPlayerError && error.message.trim().length > 0
    ? `${context}: ${error.message}`
    : context;
}

export function reportPlayerError(context: string, error: unknown): void {
  currentError = playerFailureMessage(context, error);
  // Do not place native/transport details in Logcat. Recovery detail reaches
  // this boundary only through the explicit localized marker above.
  console.error(currentError);
  emit();
}

export function clearPlayerError(): void {
  if (currentError === null) return;
  currentError = null;
  emit();
}

export function usePlayerError(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentError,
    () => currentError,
  );
}
