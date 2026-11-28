import type { PartyState } from '../api/types';
import { musicQueryClient, queryKeys } from '../data';
import { musicRepository } from '../data/repositories';
import Player, { PlaybackState } from '../player/player';
import { activePartyItemId, getQueueSnapshot, releasePartyQueue, syncPartyQueue } from '../player/controller';
import { mediaItemToTrack } from '../player/mediaItem';
import { installActivePartyRouter } from './activeParty';
import { openPartyStream } from './partyStream';
import { PartySession, usePartySessionSnapshot, type PartySessionSnapshot } from './partySession';

let instance: PartySession | null = null;
const partyCodeListeners = new Set<(code: string | null) => void>();

export function subscribePartyCodeChanges(listener: (code: string | null) => void): () => void {
  partyCodeListeners.add(listener);
  return () => {
    partyCodeListeners.delete(listener);
  };
}

/** The app-wide party session, wired to the real API, live stream and player. */
export function partySession(): PartySession {
  if (instance === null) {
    instance = new PartySession({
      repository: musicRepository,
      openStream: (code, handlers) => openPartyStream(code, handlers),
      player: Player,
      releaseQueue: releasePartyQueue,
      syncQueue: syncPartyQueue,
      activePartyItemId,
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (callback, ms) => setInterval(callback, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      onTracksStored: () => {
        void musicQueryClient.invalidateQueries({
          queryKey: queryKeys.storage.cachedTrackIds(),
          exact: true,
        });
      },
      onPartyCodeChange: (code) => {
        for (const listener of [...partyCodeListeners]) listener(code);
      },
    });
    installActivePartyRouter(instance);
  }
  return instance;
}

export function usePartySession(): PartySessionSnapshot {
  return usePartySessionSnapshot(partySession());
}

/**
 * Start a party that continues this device's queue right where it is: same
 * entries, same current entry, play state and position. Opens the session.
 */
export async function startPartyFromQueue(): Promise<PartyState> {
  const { items, activeIndex } = getQueueSnapshot();
  const tracks = items.map((item, index) => {
    const track = mediaItemToTrack(item);
    if (track === null) {
      throw new Error(`Queue entry ${index + 1} has no song data and cannot join a party`);
    }
    return track;
  });
  const snapshot = Player.getSnapshot();
  const position = snapshot.progress.position;
  if (activeIndex !== null && (!Number.isFinite(position) || position < 0)) {
    throw new Error(`Native player reported invalid playback position ${String(position)}`);
  }
  const party = await musicRepository.createParty({
    tracks,
    current_index: activeIndex ?? -1,
    is_playing: activeIndex !== null && (snapshot.isPlaying || snapshot.playbackState === PlaybackState.Buffering),
    position_sec: activeIndex === null ? 0 : position,
  });
  partySession().enter(party.code, party);
  return party;
}
