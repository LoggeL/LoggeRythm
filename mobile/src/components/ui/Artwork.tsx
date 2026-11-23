import React, { useSyncExternalStore } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { strings } from '../../localization';
import { colors, radii } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';

export interface ArtworkProps {
  /** Absolute image URL. null/undefined/'' renders the missing-cover placeholder only. */
  uri: string | null | undefined;
  /** Edge length in dp (use layout.artwork.*), or 'fill' for width 100% + square aspect. */
  size: number | 'fill';
  /** round = artists/avatars, square = everything else. */
  shape?: 'square' | 'round';
  /** Corner radius token for square artwork. Defaults by size (sm below 64dp, card above). */
  radius?: keyof typeof radii;
  /** Placeholder glyph for missing cover: music-note (default), album, account-music, ... */
  icon?: AppIconName;
  /** Only set when the artwork itself conveys information; it is decorative by default. */
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export type ArtworkLoadState = 'loading' | 'loaded' | 'error';

const MAX_TRACKED_URLS = 500;
const FIRST_LOAD_FADE_MS = 160;

const loadedUrls = new Set<string>();
const failedUrls = new Set<string>();
const listenersByUrl = new Map<string, Set<() => void>>();

function addBounded(set: Set<string>, url: string): void {
  if (set.has(url)) {
    set.delete(url);
  } else if (set.size >= MAX_TRACKED_URLS) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
  set.add(url);
}

function notifyUrl(url: string): void {
  const listeners = listenersByUrl.get(url);
  if (listeners === undefined) return;
  listeners.forEach((listener) => listener());
}

function subscribeUrl(url: string, listener: () => void): () => void {
  let listeners = listenersByUrl.get(url);
  if (listeners === undefined) {
    listeners = new Set();
    listenersByUrl.set(url, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners !== undefined && listeners.size === 0) {
      listenersByUrl.delete(url);
    }
  };
}

function normalizeArtworkUri(uri: string | null | undefined): string | null {
  if (typeof uri !== 'string') return null;
  const trimmed = uri.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** True if this artwork URL has already loaded in the current session (renders with fadeDuration={0}). */
export function isArtworkLoaded(uri: string): boolean {
  return loadedUrls.has(uri);
}

/** True if this artwork URL most recently failed to load. */
export function isArtworkFailed(uri: string): boolean {
  return failedUrls.has(uri);
}

export function getArtworkLoadState(uri: string): ArtworkLoadState {
  if (loadedUrls.has(uri)) return 'loaded';
  if (failedUrls.has(uri)) return 'error';
  return 'loading';
}

export function markArtworkLoaded(uri: string): void {
  const changed = !loadedUrls.has(uri) || failedUrls.has(uri);
  failedUrls.delete(uri);
  addBounded(loadedUrls, uri);
  if (changed) notifyUrl(uri);
}

export function markArtworkFailed(uri: string): void {
  const changed = !failedUrls.has(uri) || loadedUrls.has(uri);
  loadedUrls.delete(uri);
  addBounded(failedUrls, uri);
  if (changed) notifyUrl(uri);
}

/** Test-only reset for the session artwork URL cache. */
export function resetArtworkCacheForTests(): void {
  loadedUrls.clear();
  failedUrls.clear();
  listenersByUrl.clear();
}

export interface ArtworkErrorBadgeProps {
  borderRadius: number;
  glyphSize: number;
  testID?: string;
}

/** Pure broken-cover surface rendered when a remote artwork URL fails to load. */
export function ArtworkErrorSurface({
  borderRadius,
  glyphSize,
  testID,
}: ArtworkErrorBadgeProps) {
  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.errorOverlay, { borderRadius }]}
    >
      <AppIcon name="image-broken-variant" color={colors.danger} size={glyphSize} />
    </View>
  );
}

interface ArtworkFailureOverlayProps {
  uri: string;
  borderRadius: number;
  glyphSize: number;
  testID?: string;
}

/**
 * Targeted per-URL observer wrapped in React.memo: stays zero-cost when loaded
 * and keeps direct-call Vitest tests of parent components hook-free while
 * reacting immediately on real `Image.onError` / `onLoad` transitions.
 */
const ArtworkFailureOverlay = React.memo(function ArtworkFailureOverlay({
  uri,
  borderRadius,
  glyphSize,
  testID,
}: ArtworkFailureOverlayProps) {
  const state = useSyncExternalStore(
    (listener) => subscribeUrl(uri, listener),
    () => getArtworkLoadState(uri),
    () => getArtworkLoadState(uri),
  );
  if (state !== 'error') return null;
  return (
    <ArtworkErrorSurface
      borderRadius={borderRadius}
      glyphSize={glyphSize}
      testID={testID}
    />
  );
});

/**
 * Artwork is the single cover/avatar renderer with three distinct states:
 * 1. Missing cover (`uri == null` / blank): neutral tile + semantic placeholder icon.
 * 2. Remote loading / loaded cover: subtle placeholder surface (no icon bleed-through)
 *    with `fadeDuration={0}` for already-seen URLs to eliminate FlatList recycle flashes.
 * 3. Load error (`onError`): distinct broken-cover state (`image-broken-variant` on
 *    `dangerSubtle` with `danger` border) so broken URLs never masquerade as missing.
 */
export function Artwork({
  uri,
  size,
  shape = 'square',
  radius,
  icon = 'music-note',
  accessibilityLabel,
  testID,
  style,
}: ArtworkProps) {
  const fill = size === 'fill';
  const edge = fill ? 96 : size;
  const borderRadius =
    shape === 'round' ? radii.pill : radii[radius ?? (edge < 64 ? 'sm' : 'card')];
  const glyphSize = fill ? 40 : Math.round(edge * 0.42);
  const normalizedUri = normalizeArtworkUri(uri);
  const labelled = accessibilityLabel !== undefined;
  const loaded = normalizedUri !== null && isArtworkLoaded(normalizedUri);
  const failed = normalizedUri !== null && isArtworkFailed(normalizedUri);
  const resolvedAccessibilityLabel =
    labelled && failed
      ? `${accessibilityLabel} (${strings.common.artworkLoadFailed})`
      : accessibilityLabel;

  return (
    <View
      testID={testID}
      accessible={labelled}
      accessibilityRole={labelled ? 'image' : undefined}
      accessibilityLabel={resolvedAccessibilityLabel}
      importantForAccessibility={labelled ? 'yes' : 'no-hide-descendants'}
      style={[
        styles.tile,
        normalizedUri === null ? styles.missingTile : styles.loadingTile,
        fill ? styles.fill : { width: edge, height: edge },
        { borderRadius },
        style,
      ]}
    >
      {normalizedUri === null ? (
        <AppIcon name={icon} color={colors.textMuted} size={glyphSize} />
      ) : (
        <>
          <Image
            accessible={false}
            source={{ uri: normalizedUri }}
            resizeMode="cover"
            fadeDuration={loaded ? 0 : FIRST_LOAD_FADE_MS}
            onLoad={() => markArtworkLoaded(normalizedUri)}
            onError={() => markArtworkFailed(normalizedUri)}
            style={styles.image}
          />
          {failed ? (
            <ArtworkErrorSurface
              borderRadius={borderRadius}
              glyphSize={glyphSize}
              testID={testID ? `${testID}-error` : undefined}
            />
          ) : (
            <ArtworkFailureOverlay
              uri={normalizedUri}
              borderRadius={borderRadius}
              glyphSize={glyphSize}
              testID={testID ? `${testID}-error` : undefined}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  missingTile: {
    backgroundColor: colors.surfaceElevated,
  },
  loadingTile: {
    backgroundColor: colors.surface,
  },
  fill: { width: '100%', aspectRatio: 1 },
  image: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  errorOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerSubtle,
    borderWidth: 1,
    borderColor: colors.danger,
  },
});
