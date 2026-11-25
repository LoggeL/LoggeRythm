import { useSyncExternalStore } from 'react';
import type { AudioQualityTier } from '../api/types';

const DEFAULT_QUALITY: AudioQualityTier = 'high';

let currentQuality: AudioQualityTier = DEFAULT_QUALITY;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getAudioQualityPreference(): AudioQualityTier {
  return currentQuality;
}

export function setAudioQualityPreference(quality: AudioQualityTier): void {
  if (quality !== 'lossless' && quality !== 'high' && quality !== 'saver') {
    throw new Error(`Invalid audio quality tier: ${String(quality)}`);
  }
  if (currentQuality === quality) return;
  currentQuality = quality;
  notify();
}

export function resetAudioQualityPreference(): void {
  if (currentQuality === DEFAULT_QUALITY) return;
  currentQuality = DEFAULT_QUALITY;
  notify();
}

export function subscribeAudioQualityPreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAudioQualityPreference(): AudioQualityTier {
  return useSyncExternalStore(
    subscribeAudioQualityPreference,
    getAudioQualityPreference,
    getAudioQualityPreference,
  );
}

/**
 * Resolve the MIME type for a stream quality tier.
 * Lossless serves FLAC; high/saver serve MPEG audio.
 */
export function audioMimeTypeForQuality(quality: AudioQualityTier): 'audio/flac' | 'audio/mpeg' {
  return quality === 'lossless' ? 'audio/flac' : 'audio/mpeg';
}

/**
 * Append the explicit `?quality=` query parameter only when non-default (`lossless` or `saver`)
 * so canonical `high` stream URLs remain unchanged across tests and caches.
 */
export function buildTrackStreamUri(
  apiBase: string,
  trackId: string,
  quality: AudioQualityTier = currentQuality,
): string {
  const baseUri = `${apiBase}/api/tracks/${trackId}/stream`;
  if (quality === 'high') return baseUri;
  return `${baseUri}?quality=${encodeURIComponent(quality)}`;
}

/**
 * Build the authenticated stream URI for explicit MP3 offline downloads.
 * Always passes an explicit `?quality=high` or `?quality=saver` parameter so a
 * server-side `user.preferred_quality = 'lossless'` setting can never serve
 * `audio/flac` to the MP3-only native offline downloader.
 */
export function buildOfflineTrackStreamUri(
  apiBase: string,
  trackId: string,
  quality: AudioQualityTier = currentQuality,
): string {
  const offlineQuality = quality === 'saver' ? 'saver' : 'high';
  return `${apiBase}/api/tracks/${trackId}/stream?quality=${offlineQuality}`;
}
