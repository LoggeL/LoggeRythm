import type { PlaybackSettings } from '../api/types';
import { musicQueryClient, musicQueries } from '../data';
import {
  resetAudioQualityPreference,
  setAudioQualityPreference,
} from './qualityPreference';

async function loadNativeAudioCraft(): Promise<typeof import('./nativeAudioCraft') | null> {
  try {
    return await import('./nativeAudioCraft');
  } catch (error) {
    if (process.env.VITEST === 'true') return null;
    throw new Error(
      `Failed to load nativeAudioCraft for playback settings sync: ${(error as Error).message}`,
    );
  }
}

/**
 * Push account-level playback preferences (stream quality tier + native crossfade)
 * into the in-memory quality store and native Media3 crossfade engine.
 */
export async function syncNativePlaybackSettings(settings: PlaybackSettings): Promise<void> {
  if (settings.preferred_quality !== undefined) {
    setAudioQualityPreference(settings.preferred_quality);
  }
  const craft = await loadNativeAudioCraft();
  if (craft !== null && craft.isNativeMethodAvailable('setCrossfadeConfig')) {
    await craft.setCrossfadeConfig(
      settings.crossfade_enabled,
      settings.crossfade_duration_sec,
    );
  }
}

/**
 * Reset account-scoped quality and native crossfade state on sign-out or account switch
 * so an outgoing account's preferences never leak into another session.
 */
export function resetNativePlaybackSettings(): void {
  resetAudioQualityPreference();
  void loadNativeAudioCraft()
    .then((craft) => {
      if (craft !== null && craft.isNativeMethodAvailable('setCrossfadeConfig')) {
        return craft.setCrossfadeConfig(false, 0);
      }
      return undefined;
    })
    .catch((cause: unknown) => {
      console.error('[LoggeRythm] Failed to reset native crossfade config on sign-out:', cause);
    });
}

/**
 * Hydrate account playback settings (`GET /api/me/settings`) once per approved
 * session after player bootstrap, applying `preferred_quality` and native
 * crossfade without requiring the user to visit ProfileScreen first.
 */
export async function hydrateAccountPlaybackSettings(
  accountScope: string,
  isStillCurrent: () => boolean = () => true,
): Promise<void> {
  const settings = await musicQueryClient.fetchQuery(
    musicQueries.playbackSettings(accountScope),
  );
  if (!isStillCurrent()) return;
  await syncNativePlaybackSettings(settings);
}
