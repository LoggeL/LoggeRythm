import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { isTvMode } from './tvEnvironment';

export interface TvFocusTarget {
  /** Imperatively request D-Pad focus on this registered element. */
  requestFocus: () => void;
  /** Optional native Android view tag (from `findNodeHandle`) for `nextFocus*` linking. */
  getNodeHandle?: () => number | null;
}

export interface TvFocusCheckpoint {
  readonly label?: string;
  readonly focusKey: string | null;
  readonly scope: string | null;
}

export interface TvFocusRegistry {
  register(focusKey: string, target: TvFocusTarget, scope?: string): () => void;
  recordFocus(focusKey: string, scope?: string): void;
  recordBlur(focusKey: string): void;
  getCurrentFocusedKey(): string | null;
  getLastFocusedKey(scope?: string): string | null;
  getNodeHandle(focusKey: string): number | null;
  requestFocus(focusKey: string, options?: { deferIfUnmounted?: boolean }): boolean;
  pushCheckpoint(label?: string): TvFocusCheckpoint;
  popAndRestore(fallbackKey?: string): string | null;
  restoreScopeFocus(scope: string, fallbackKey?: string): string | null;
  subscribe(listener: () => void): () => void;
  reset(): void;
}

interface RegistrationEntry {
  readonly target: TvFocusTarget;
  readonly scope: string | null;
}

function assertNonEmptyKey(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`TvFocusRegistry: ${name} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Focus registry & focus-memory store for Android TV D-Pad navigation.
 *
 * Tracks the currently focused and last-focused item globally and per scope
 * (screen / rail / modal), maintains a checkpoint stack for returning from
 * NowPlaying, Queue, sheets, or detail routes, and resolves logical focus keys
 * to native Android view handles for deterministic `nextFocus*` wiring.
 */
export function createTvFocusRegistry(): TvFocusRegistry {
  const entries = new Map<string, RegistrationEntry>();
  const lastFocusedByScope = new Map<string, string>();
  const checkpoints: TvFocusCheckpoint[] = [];
  const listeners = new Set<() => void>();

  let currentFocusedKey: string | null = null;
  let lastFocusedKey: string | null = null;
  let lastFocusedScope: string | null = null;
  let pendingFocusKey: string | null = null;

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const register: TvFocusRegistry['register'] = (rawKey, target, rawScope) => {
    const focusKey = assertNonEmptyKey(rawKey, 'focusKey');
    const scope = rawScope === undefined ? null : assertNonEmptyKey(rawScope, 'scope');
    if (!target || typeof target.requestFocus !== 'function') {
      throw new TypeError(`TvFocusRegistry: target for "${focusKey}" must provide requestFocus()`);
    }

    const entry: RegistrationEntry = { target, scope };
    entries.set(focusKey, entry);

    if (pendingFocusKey === focusKey) {
      pendingFocusKey = null;
      target.requestFocus();
    }
    notify();

    return () => {
      if (entries.get(focusKey) !== entry) return;
      entries.delete(focusKey);
      if (currentFocusedKey === focusKey) {
        currentFocusedKey = null;
      }
      notify();
    };
  };

  const recordFocus: TvFocusRegistry['recordFocus'] = (rawKey, rawScope) => {
    const focusKey = assertNonEmptyKey(rawKey, 'focusKey');
    const registeredScope = entries.get(focusKey)?.scope ?? null;
    const scope = rawScope === undefined ? registeredScope : assertNonEmptyKey(rawScope, 'scope');
    currentFocusedKey = focusKey;
    lastFocusedKey = focusKey;
    lastFocusedScope = scope;
    if (scope !== null) {
      lastFocusedByScope.set(scope, focusKey);
    }
    if (pendingFocusKey === focusKey) {
      pendingFocusKey = null;
    }
    notify();
  };

  const recordBlur: TvFocusRegistry['recordBlur'] = (rawKey) => {
    const focusKey = assertNonEmptyKey(rawKey, 'focusKey');
    if (currentFocusedKey !== focusKey) return;
    currentFocusedKey = null;
    notify();
  };

  const requestFocus: TvFocusRegistry['requestFocus'] = (
    rawKey,
    { deferIfUnmounted = true } = {},
  ) => {
    const focusKey = assertNonEmptyKey(rawKey, 'focusKey');
    const entry = entries.get(focusKey);
    if (entry) {
      pendingFocusKey = null;
      entry.target.requestFocus();
      return true;
    }
    if (deferIfUnmounted) {
      pendingFocusKey = focusKey;
    }
    return false;
  };

  const getLastFocusedKey: TvFocusRegistry['getLastFocusedKey'] = (rawScope) => {
    if (rawScope === undefined) return lastFocusedKey;
    const scope = assertNonEmptyKey(rawScope, 'scope');
    return lastFocusedByScope.get(scope) ?? null;
  };

  const getNodeHandle: TvFocusRegistry['getNodeHandle'] = (rawKey) => {
    const focusKey = assertNonEmptyKey(rawKey, 'focusKey');
    const handle = entries.get(focusKey)?.target.getNodeHandle?.() ?? null;
    return typeof handle === 'number' && Number.isInteger(handle) && handle > 0 ? handle : null;
  };

  const pushCheckpoint: TvFocusRegistry['pushCheckpoint'] = (label) => {
    const checkpoint: TvFocusCheckpoint = Object.freeze({
      label,
      focusKey: currentFocusedKey ?? lastFocusedKey,
      scope: lastFocusedScope,
    });
    checkpoints.push(checkpoint);
    return checkpoint;
  };

  const popAndRestore: TvFocusRegistry['popAndRestore'] = (fallbackKey) => {
    const checkpoint = checkpoints.pop();
    const candidate = checkpoint?.focusKey ?? fallbackKey ?? null;
    if (candidate === null) return null;
    requestFocus(candidate, { deferIfUnmounted: true });
    return candidate;
  };

  const restoreScopeFocus: TvFocusRegistry['restoreScopeFocus'] = (rawScope, fallbackKey) => {
    const scope = assertNonEmptyKey(rawScope, 'scope');
    const candidate = lastFocusedByScope.get(scope) ?? fallbackKey ?? null;
    if (candidate === null) return null;
    requestFocus(candidate, { deferIfUnmounted: true });
    return candidate;
  };

  const subscribe: TvFocusRegistry['subscribe'] = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const reset: TvFocusRegistry['reset'] = () => {
    entries.clear();
    lastFocusedByScope.clear();
    checkpoints.length = 0;
    currentFocusedKey = null;
    lastFocusedKey = null;
    lastFocusedScope = null;
    pendingFocusKey = null;
    listeners.clear();
  };

  return {
    register,
    recordFocus,
    recordBlur,
    getCurrentFocusedKey: () => currentFocusedKey,
    getLastFocusedKey,
    getNodeHandle,
    requestFocus,
    pushCheckpoint,
    popAndRestore,
    restoreScopeFocus,
    subscribe,
    reset,
  };
}

/** Shared app-wide TV focus registry. */
export const tvFocusRegistry: TvFocusRegistry = createTvFocusRegistry();

/** Test-only reset for isolating shared TV focus memory between cases. */
export function resetTvFocusRegistryForTests(): void {
  tvFocusRegistry.reset();
}

export interface TvFocusScopeContextValue {
  readonly scope: string | null;
  readonly registry: TvFocusRegistry;
}

const TvFocusScopeContext = createContext<TvFocusScopeContextValue>({
  scope: null,
  registry: tvFocusRegistry,
});

export interface TvFocusScopeProps {
  /** Logical scope name (e.g. `'home'`, `'search'`, `'library'`, `'queue'`, `'now-playing'`). */
  scope: string;
  registry?: TvFocusRegistry;
  children: React.ReactNode;
}

/**
 * Declares a named focus-memory scope for descendant `TvFocusable` elements.
 * RN 0.86 core does not ship `TVFocusGuideView`; `TvFocusScope` + `useTvFocusReturn`
 * provides deterministic per-screen focus memory and return without a third-party TV fork.
 */
export function TvFocusScope({
  scope,
  registry = tvFocusRegistry,
  children,
}: TvFocusScopeProps) {
  const normalizedScope = assertNonEmptyKey(scope, 'scope');
  const value = useMemo<TvFocusScopeContextValue>(
    () => ({ scope: normalizedScope, registry }),
    [normalizedScope, registry],
  );
  return React.createElement(TvFocusScopeContext.Provider, { value }, children);
}

export function useTvFocusScope(): TvFocusScopeContextValue {
  return useContext(TvFocusScopeContext);
}

export interface UseTvFocusReturnOptions {
  /** Scope whose last focused item should be restored when `active` becomes true. */
  scope: string;
  /** Whether the screen or modal is currently active/visible (e.g. React Navigation `useIsFocused()`). */
  active: boolean;
  /** Initial/fallback `focusKey` to focus when the scope has no recorded focus yet. */
  fallbackKey?: string;
  /** Only restore focus when TV mode is active (defaults to `isTvMode()`). */
  enabled?: boolean;
  registry?: TvFocusRegistry;
}

export interface TvFocusReturnControls {
  /** Last focus key recorded inside `scope`, or `null`. */
  readonly lastFocusedKey: string | null;
  /** Imperatively restore focus to the last focused item in `scope` (or `fallbackKey`). */
  readonly restore: () => string | null;
  /** Save the current focused element onto the return stack before opening a modal/player/detail route. */
  readonly pushCheckpoint: (label?: string) => TvFocusCheckpoint;
  /** Pop the return stack and restore focus to the previously focused element. */
  readonly popAndRestore: (overrideFallbackKey?: string) => string | null;
}

/**
 * Restores TV D-Pad focus predictably when returning to a screen, tab, or dismissing a
 * modal/player/queue overlay. Does nothing on touch phones unless `enabled` is forced.
 */
export function useTvFocusReturn({
  scope,
  active,
  fallbackKey,
  enabled,
  registry = tvFocusRegistry,
}: UseTvFocusReturnOptions): TvFocusReturnControls {
  const normalizedScope = assertNonEmptyKey(scope, 'scope');
  const wasActiveRef = useRef(false);
  const isEnabled = enabled ?? isTvMode();

  useEffect(() => {
    const becameActive = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (!isEnabled || !becameActive) return;
    registry.restoreScopeFocus(normalizedScope, fallbackKey);
  }, [active, fallbackKey, isEnabled, normalizedScope, registry]);

  const restore = useCallback(
    () => registry.restoreScopeFocus(normalizedScope, fallbackKey),
    [fallbackKey, normalizedScope, registry],
  );

  const pushCheckpoint = useCallback(
    (label?: string) => registry.pushCheckpoint(label ?? normalizedScope),
    [normalizedScope, registry],
  );

  const popAndRestore = useCallback(
    (overrideFallbackKey?: string) =>
      registry.popAndRestore(overrideFallbackKey ?? fallbackKey),
    [fallbackKey, registry],
  );

  return {
    lastFocusedKey: registry.getLastFocusedKey(normalizedScope),
    restore,
    pushCheckpoint,
    popAndRestore,
  };
}
