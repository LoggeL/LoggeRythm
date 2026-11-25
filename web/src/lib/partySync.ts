import type { PartyState } from "@/types";

export type HostBroadcastReason = "change" | "heartbeat";

export interface LocalPartyPlayerSlice {
  queue: readonly unknown[];
  index: number;
  isPlaying: boolean;
  partyQueueItemIds: readonly number[];
}

/** Server entry ID of the track currently loaded in the local player, or null for non-party playback. */
export function activePartyItemId(
  player: Pick<LocalPartyPlayerSlice, "index" | "partyQueueItemIds">,
): number | null {
  if (player.index < 0 || player.index >= player.partyQueueItemIds.length) return null;
  const id = player.partyQueueItemIds[player.index];
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Server entry ID of the party's currently selected track, or null when nothing is selected. */
export function partyCurrentItemId(
  party: Pick<PartyState, "current_index" | "tracks"> | null,
): number | null {
  if (!party || party.current_index < 0 || party.current_index >= party.tracks.length) {
    return null;
  }
  const id = party.tracks[party.current_index]?.id;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * True when the local player has a non-empty queue whose active entry does not
 * belong to the Jam (e.g. the user clicked Play on a song/playlist outside the Jam).
 */
export function isLocalPlaybackDetachedFromParty(
  player: Pick<LocalPartyPlayerSlice, "queue" | "index" | "partyQueueItemIds">,
): boolean {
  return player.queue.length > 0 && activePartyItemId(player) === null;
}

/**
 * If the host's local player moved to a different entry in the same party queue
 * (e.g. via crossfade), returns that entry's current index on the server.
 */
export function findHostTrackAdvanceIndex(
  party: Pick<PartyState, "current_index" | "tracks"> | null,
  player: Pick<LocalPartyPlayerSlice, "index" | "partyQueueItemIds">,
): number | null {
  if (!party) return null;
  const localItemId = activePartyItemId(player);
  const serverItemId = partyCurrentItemId(party);
  if (localItemId === null || localItemId === serverItemId) return null;
  const idx = party.tracks.findIndex((track) => track.id === localItemId);
  return idx >= 0 ? idx : null;
}

/**
 * True when the host should send PATCH /party/{code}/playback.
 *
 * Guards against the two causes of 409 "Select a party track before starting playback":
 * 1. The party has no selected track (`current_index < 0`).
 * 2. The local player is detached or not on the party's current entry.
 *
 * Also avoids pointless 3s heartbeat writes when both host and server are already paused.
 */
export function shouldHostBroadcastPlayback(
  party: Pick<PartyState, "code" | "is_host" | "ended" | "current_index" | "is_playing" | "tracks"> | null,
  player: Pick<LocalPartyPlayerSlice, "index" | "isPlaying" | "partyQueueItemIds">,
  options: {
    detached: boolean;
    exitingCode: string | null;
    reason: HostBroadcastReason;
  },
): boolean {
  if (!party || !party.is_host || party.ended) return false;
  if (options.detached || options.exitingCode === party.code.toUpperCase()) return false;
  const serverItemId = partyCurrentItemId(party);
  if (serverItemId === null) return false;
  const localItemId = activePartyItemId(player);
  if (localItemId === null || localItemId !== serverItemId) return false;
  if (options.reason === "heartbeat" && !player.isPlaying && !party.is_playing) {
    return false;
  }
  return true;
}

/** True when remote play/pause/seek PATCH /playback calls are valid for the party. */
export function canSendRemotePartyPlayback(
  party: Pick<PartyState, "current_index" | "tracks" | "ended"> | null,
): boolean {
  return Boolean(party && !party.ended && partyCurrentItemId(party) !== null);
}

/**
 * Detect whether a viewer who was previously confirmed in `members` has since
 * disappeared from the Jam (kicked by host, or host left from another tab/device).
 *
 * Requires `wasMember === true` so an initial SSE frame racing ahead of POST /join
 * never falsely kicks a joining participant.
 */
export function detectMemberRemoval(
  next: Pick<PartyState, "is_host" | "viewer_key" | "members">,
  wasMember: boolean,
): "kicked" | "left_elsewhere" | null {
  if (!wasMember || !next.viewer_key) return null;
  if (next.members.length > 0 && !next.members.every((member) => Boolean(member.key))) {
    return null;
  }
  if (next.members.some((member) => member.key === next.viewer_key)) {
    return null;
  }
  return next.is_host ? "left_elsewhere" : "kicked";
}

/** Whether a GET /party/active restore response should activate in the store. */
export function shouldRestoreActiveParty(
  found: Pick<PartyState, "code" | "ended"> | null,
  store: {
    code: string | null;
    exitingCode: string | null;
    lastExitedCode: string | null;
  },
): boolean {
  if (!found || found.ended) return false;
  const code = found.code.toUpperCase();
  if (store.code && store.code !== code) return false;
  if (store.exitingCode === code || store.lastExitedCode === code) return false;
  return true;
}

/** Whether opening `/party/[code]` should bind `normalizedCode` into the global Jam store. */
export function shouldBindPartyRoute(
  normalizedCode: string | null,
  store: {
    code: string | null;
    ended: boolean;
    endedCode: string | null;
    exitingCode: string | null;
  },
  leftCode: string | null,
): boolean {
  if (!normalizedCode) return false;
  if (leftCode === normalizedCode || store.exitingCode === normalizedCode) return false;
  if (store.ended && store.endedCode === normalizedCode) return false;
  return store.code !== normalizedCode;
}
