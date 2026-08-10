"use client";

import { useCallback, useSyncExternalStore } from "react";

// Per-key cache so getSnapshot returns a stable reference unless the raw
// string changed (required by useSyncExternalStore to avoid render loops).
const cache = new Map<string, { raw: string | null; value: unknown }>();

function readSnapshot<T>(key: string, fallback: T): T {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
  const entry = cache.get(key);
  if (entry && entry.raw === raw) return entry.value as T;
  let value: T = fallback;
  if (raw) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  cache.set(key, { raw, value });
  return value;
}

function eventName(key: string) {
  return `local-json:${key}`;
}

/**
 * Read + write a JSON value in localStorage, SSR-safe and reactive within the
 * tab. Server renders `fallback`; the client re-renders after hydration.
 */
export function useLocalJson<T>(
  key: string,
  fallback: T,
): [T, (next: T | ((current: T) => T)) => void] {
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
    () => readSnapshot(key, fallback),
    () => fallback,
  );

  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      // Functional updates read the *current* stored value, so long-running
      // async flows can't clobber writes made since they captured `value`.
      const resolved =
        typeof next === "function"
          ? (next as (current: T) => T)(readSnapshot(key, fallback))
          : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // ignore quota/availability errors
      }
      window.dispatchEvent(new Event(eventName(key)));
    },
    [key, fallback],
  );

  return [value, setValue];
}
