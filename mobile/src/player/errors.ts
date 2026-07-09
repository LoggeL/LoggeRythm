import { useSyncExternalStore } from 'react';

let currentError: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function reportPlayerError(context: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  currentError = `${context}: ${detail}`;
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
