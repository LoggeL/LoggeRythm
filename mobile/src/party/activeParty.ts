import type { Track } from '../api/types';

/** What queue actions elsewhere in the app need to know about the open party. */
export interface ActivePartyRouter {
  /** Play-next / add-to-queue go to the open party instead of this device's queue. */
  routesQueueActionsToParty(): boolean;
  /** Add a song to that party for everyone. */
  addTrack(track: Track): Promise<void>;
  /** Forget the party locally (account cleanup). */
  reset(): void;
}

let router: ActivePartyRouter | null = null;

/**
 * Installed by the party runtime when the app-wide session is created. Kept in
 * this dependency-free module so the player and track actions can consult the
 * party without importing the network and player wiring.
 */
export function installActivePartyRouter(next: ActivePartyRouter): void {
  if (router !== null && router !== next) {
    throw new Error('A different party session is already installed');
  }
  router = next;
}

export function activePartyRouter(): ActivePartyRouter | null {
  return router;
}
