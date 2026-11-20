import type { PartyState, PartyTrack, Track } from '../api/types';
import { strings } from '../localization';
import type { PartyQueueEntry } from '../player/controller';

export { normalizePartyCode } from './partyCode';

/** Seconds a following member may drift from the host before it is pulled back. */
export const MAX_PARTY_DRIFT_SEC = 1.5;

/** The public invite link, shared by the web app too. */
export function partyInviteUrl(base: string, code: string): string {
  return `${base}/party/${encodeURIComponent(code)}`;
}

export function partyDisplayName(party: Pick<PartyState, 'name'>): string {
  return party.name.trim() === '' ? strings.party.defaultName : party.name;
}

export function partyTrackToTrack(entry: PartyTrack): Track {
  return {
    id: entry.deezer_id,
    title: entry.title,
    artist: entry.artist,
    artist_id: entry.artist_id,
    artists: entry.artists,
    album: entry.album,
    album_id: entry.album_id,
    cover: entry.cover,
    duration_sec: entry.duration_sec,
    preview_url: null,
    rank: 0,
    release_date: '',
  };
}

export function partyQueueEntries(party: PartyState): PartyQueueEntry[] {
  return party.tracks.map((entry) => ({ itemId: entry.id, track: partyTrackToTrack(entry) }));
}

/**
 * Where the host's current track is now: the last broadcast position plus the
 * time that has passed since, while playing.
 */
export function expectedHostPosition(party: PartyState, nowMs: number): number {
  if (!party.is_playing || party.playback_updated_at === null) return party.position_sec;
  const updatedAt = Date.parse(party.playback_updated_at);
  if (!Number.isFinite(updatedAt)) {
    throw new Error(`Party playback timestamp ${party.playback_updated_at} is not a date`);
  }
  return Math.max(0, party.position_sec + (nowMs - updatedAt) / 1000);
}

/** The host removes anything; everyone else only their own upcoming additions. */
export function canRemovePartyTrack(party: PartyState, index: number): boolean {
  const entry = party.tracks[index];
  if (entry === undefined) return false;
  if (party.is_host) return true;
  return (
    entry.added_by_member !== '' &&
    entry.added_by_member === party.viewer_key &&
    index !== party.current_index
  );
}

export function partyLoadLabel(entry: Pick<PartyTrack, 'load_state' | 'load_error'>): string {
  switch (entry.load_state) {
    case 'ready':
      return strings.party.loadReady;
    case 'loading':
      return strings.party.loadLoading;
    case 'queued':
      return strings.party.loadQueued;
    case 'failed':
      if (entry.load_error === null || entry.load_error.trim() === '') {
        throw new Error('A failed party track load must carry its cause');
      }
      return strings.party.loadFailedState(entry.load_error);
    case 'idle':
      return strings.party.loadIdle;
  }
}

/** Move the entry at `from` to `to` in a list of server entry IDs. */
export function movedPartyIds(ids: readonly number[], from: number, to: number): number[] {
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) {
    throw new RangeError(`Cannot move party entry ${from} to ${to} in a ${ids.length}-entry queue`);
  }
  const next = [...ids];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
