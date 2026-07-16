import type { RecentPlay, Track } from '../api/types';
import {
  resolveRemoteVisualState,
  type RemoteVisualState,
  type RemoteVisualStateInput,
} from '../data/remoteState';

export const RADIO_MOODS = [
  { tag: 'chill' },
  { tag: 'focus' },
  { tag: 'workout' },
  { tag: 'party' },
] as const;

export type RadioMoodTag = (typeof RADIO_MOODS)[number]['tag'];
export type RadioContentState = RemoteVisualState;

export function personalStationIds(recent: readonly RecentPlay[], limit = 12): string[] {
  if (!Number.isInteger(limit) || limit < 0) throw new Error(`radio station limit must be non-negative; received ${limit}`);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const [index, play] of recent.entries()) {
    const id = String(play.id).trim();
    if (id.length === 0) throw new Error(`recent play ${index} has no track id`);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === limit) break;
  }
  return ids;
}

/** Radio seed lists are unique by track id while retaining first-source order. */
export function orderedUniqueRadioTracks(tracks: readonly Track[]): Track[] {
  const seen = new Set<string>();
  const ordered: Track[] = [];
  for (const [index, track] of tracks.entries()) {
    const id = String(track.id).trim();
    if (id.length === 0) throw new Error(`radio track ${index} has no id`);
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(track);
  }
  return ordered;
}

/** Radio uses the same last-good-data and mutually exclusive notice contract as Library. */
export function radioContentState(input: RemoteVisualStateInput): RadioContentState {
  return resolveRemoteVisualState(input);
}
