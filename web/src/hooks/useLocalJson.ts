"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

// Per-key cache so getSnapshot returns a stable reference unless the raw
// string changed (required by useSyncExternalStore to avoid render loops).
const cache = new Map<string, { raw: string | null; value: unknown }>();

function storageError(key: string, action: string, cause: unknown): Error {
  return new Error(
    `Lokale Daten "${key}" konnten nicht ${action} werden: ${cause instanceof Error ? cause.message : String(cause)}`,
    { cause },
  );
}

export function readLocalJsonSnapshot<T>(key: string, initialValue: T): T {
  if (typeof window === "undefined") return initialValue;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch (cause) {
    throw storageError(key, "gelesen", cause);
  }
  const entry = cache.get(key);
  if (entry && entry.raw === raw) return entry.value as T;
  let value: T = initialValue;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch (cause) {
      throw storageError(key, "als JSON gelesen", cause);
    }
  }
  cache.set(key, { raw, value });
  return value;
}

function eventName(key: string) {
  return `local-json:${key}`;
}

export function writeLocalJsonValue<T>(key: string, value: T): void {
  try {
    const raw = JSON.stringify(value);
    if (raw === undefined) throw new Error("Der Wert ist nicht als JSON speicherbar.");
    window.localStorage.setItem(key, raw);
  } catch (cause) {
    throw storageError(key, "gespeichert", cause);
  }
  window.dispatchEvent(new Event(eventName(key)));
}

/**
 * Read + write a JSON value in localStorage, SSR-safe and reactive within the
 * tab. Server renders `fallback`; the client re-renders after hydration.
 */
export function useLocalJson<T>(
  key: string,
  fallback: T,
): [T, (next: T | ((current: T) => T)) => void] {
  const [writeError, setWriteError] = useState<Error | null>(null);
  const subscribe = useCallback(
    (cb: () => void) => {
      const handler = () => cb();
      window.addEventListener(eventName(key), handler);
      window.addEventListener("storage", handler);
      return () => {
        window.removeEventListener(eventName(key), handler);
        window.removeEventListener("storage", handler);
      };
    },
    [key],
  );

  const value = useSyncExternalStore(
    subscribe,
    () => readLocalJsonSnapshot(key, fallback),
    () => fallback,
  );

  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      // Functional updates read the *current* stored value, so long-running
      // async flows can't clobber writes made since they captured `value`.
      try {
        const resolved =
          typeof next === "function"
            ? (next as (current: T) => T)(readLocalJsonSnapshot(key, fallback))
            : next;
        writeLocalJsonValue(key, resolved);
      } catch (cause) {
        const error = cause instanceof Error ? cause : storageError(key, "aktualisiert", cause);
        // Event-handler errors do not reach React boundaries by themselves.
        setWriteError(error);
        throw error;
      }
    },
    [key, fallback],
  );

  if (writeError) throw writeError;
  return [value, setValue];
}
