import { useSyncExternalStore } from 'react';
import type { PartyTrackInsertMode } from '../api/endpoints';
import type { Track } from '../api/types';
import type { PartySessionSnapshot } from './partySession';

/** What queue, Connect, and player chrome elsewhere in the app need to know about the open party. */
export interface ActivePartyRouter {
  /** Subscribe to snapshot updates from the installed party session. */
  subscribe(listener: () => void): () => void;
  /** Read the current party session snapshot. */
  getSnapshot(): PartySessionSnapshot;
  /** Code of the active party session, or null when idle. */
  activePartyCode(): string | null;
  /** True when the viewer is the host of the active party. */
  isHost(): boolean;
  /** The app currently routes queue actions to a party. */
  isFollowingParty(): boolean;
  /** True when the local player is muted/control-only (not mirroring audio). */
  isControlOnly(): boolean;
  /** True when this viewer is allowed to control party playback (host or shared control). */
  canControlPlayback(): boolean;
  /** Add a song to that party for everyone. */
  addTrack(track: Track, insert?: PartyTrackInsertMode): Promise<void>;
  /** Shared-control play/pause for the active Jam. */
  controlTogglePlay(): Promise<void>;
  /** Shared-control skip to next track in the active Jam. */
  controlNext(): Promise<void>;
  /** Shared-control restart/previous track in the active Jam. */
  controlPrev(): Promise<void>;
  /** Shared-control seek in the active Jam. */
  controlSeek(seconds: number): Promise<void>;
  /** Leave the active party on the server. */
  leave(): Promise<void>;
  /** End the active party on the server (host only). */
  end(): Promise<void>;
  /** Forget the party locally (account cleanup). */
  reset(): void;
}

export const IDLE_PARTY_SNAPSHOT: PartySessionSnapshot = Object.freeze({
  code: null,
  party: null,
  phase: 'idle',
  error: null,
  detached: false,
  controlOnly: false,
  playbackError: null,
  endedNotice: null,
});

let router: ActivePartyRouter | null = null;
let unsubscribeRouter: (() => void) | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Installed by the party runtime when the app-wide session is created. Kept in
 * this dependency-free module so the player, Connect, chrome, and track actions
 * can consult the party without circular or native-module imports.
 */
export function installActivePartyRouter(next: ActivePartyRouter): void {
  if (router !== null && router !== next) {
    throw new Error('A different party session is already installed');
  }
  router = next;
  unsubscribeRouter?.();
  unsubscribeRouter = next.subscribe(notifyListeners);
  notifyListeners();
}

export function activePartyRouter(): ActivePartyRouter | null {
  return router;
}

export function getActivePartySnapshot(): PartySessionSnapshot {
  return router?.getSnapshot() ?? IDLE_PARTY_SNAPSHOT;
}

export function subscribeActivePartySnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActivePartySnapshot(): PartySessionSnapshot {
  return useSyncExternalStore(
    subscribeActivePartySnapshot,
    getActivePartySnapshot,
    getActivePartySnapshot,
  );
}
