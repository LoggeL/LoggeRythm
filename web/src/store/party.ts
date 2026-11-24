import { create } from "zustand";
import type { PartyMember, PartyState, PartyTrack } from "@/types";
import type { PartyStreamStatus } from "@/lib/partySocket";

export interface PartyStoreState {
  code: string | null;
  active: boolean;
  party: PartyState | null;
  name: string;
  hostName: string;
  isHost: boolean;
  guestsCanControl: boolean;
  currentIndex: number;
  members: PartyMember[];
  tracks: PartyTrack[];
  viewerKey: string;
  viewerName: string;
  viewerIsGuest: boolean;

  // Authoritative playback state (mirrored from SSE stream).
  isPlaying: boolean;
  positionSec: number;
  /** epoch ms of the last playback update, or null if never set. */
  playbackUpdatedAt: number | null;
  playbackChangedBy: string;
  playbackRevision: number;
  ended: boolean;
  endedCode: string | null;
  endedReason: string | null;

  /**
   * Non-host signed-in member audio mode:
   * - true  → listen locally in sync with the Jam host
   * - false → control/contribute only without double audio in the same room
   */
  listenLocally: boolean;

  streamStatus: "idle" | PartyStreamStatus;
  streamError: string | null;

  setActiveCode: (code: string | null) => void;
  applyPartyState: (party: PartyState) => void;
  setParty: (state: {
    code: string;
    active?: boolean;
    name: string;
    hostName?: string;
    isHost: boolean;
    guestsCanControl?: boolean;
    currentIndex: number;
    members: PartyMember[];
    tracks?: PartyTrack[];
    viewerKey?: string;
    viewerName?: string;
    viewerIsGuest?: boolean;
    isPlaying: boolean;
    positionSec: number;
    playbackUpdatedAt: number | null;
    playbackChangedBy?: string;
    playbackRevision?: number;
    ended?: boolean;
  }) => void;
  setListenLocally: (listen: boolean) => void;
  setStreamStatus: (status: "idle" | PartyStreamStatus, error?: string | null) => void;
  markEnded: (reason: string, endedCode?: string | null) => void;
  clearParty: () => void;
}

const INITIAL = {
  code: null,
  active: false,
  party: null,
  name: "",
  hostName: "",
  isHost: false,
  guestsCanControl: false,
  currentIndex: -1,
  members: [] as PartyMember[],
  tracks: [] as PartyTrack[],
  viewerKey: "",
  viewerName: "",
  viewerIsGuest: false,
  isPlaying: false,
  positionSec: 0,
  playbackUpdatedAt: null as number | null,
  playbackChangedBy: "",
  playbackRevision: 0,
  ended: false,
  endedCode: null as string | null,
  endedReason: null as string | null,
  listenLocally: true,
  streamStatus: "idle" as const,
  streamError: null as string | null,
};

export const usePartyStore = create<PartyStoreState>((set) => ({
  ...INITIAL,

  setActiveCode: (code) =>
    set((s) =>
      code
        ? {
            code: code.toUpperCase(),
            ended: false,
            endedCode: null,
            endedReason: null,
            ...(s.code === code.toUpperCase() ? {} : { party: null, streamError: null }),
          }
        : { ...INITIAL },
    ),

  applyPartyState: (party) => {
    const updatedMs = party.playback_updated_at ? Date.parse(party.playback_updated_at) : null;
    set({
      code: party.code,
      active: !party.ended,
      party,
      name: party.name,
      hostName: party.host_name,
      isHost: party.is_host,
      guestsCanControl: Boolean(party.guests_can_control),
      currentIndex: party.current_index,
      members: party.members,
      tracks: party.tracks,
      viewerKey: party.viewer_key,
      viewerName: party.viewer_name,
      viewerIsGuest: party.viewer_is_guest,
      isPlaying: party.is_playing,
      positionSec: party.position_sec,
      playbackUpdatedAt: updatedMs !== null && Number.isFinite(updatedMs) ? updatedMs : null,
      playbackChangedBy: party.playback_changed_by ?? "",
      playbackRevision: party.playback_revision ?? 0,
      ended: Boolean(party.ended),
      endedCode: party.ended ? party.code.toUpperCase() : null,
      endedReason: party.ended ? "Die Jam wurde vom Host beendet." : null,
    });
  },

  setParty: (state) =>
    set((s) => ({
      code: state.code,
      active: state.active ?? !state.ended,
      name: state.name,
      hostName: state.hostName ?? s.hostName,
      isHost: state.isHost,
      guestsCanControl: state.guestsCanControl ?? s.guestsCanControl,
      currentIndex: state.currentIndex,
      members: state.members,
      tracks: state.tracks ?? s.tracks,
      viewerKey: state.viewerKey ?? s.viewerKey,
      viewerName: state.viewerName ?? s.viewerName,
      viewerIsGuest: state.viewerIsGuest ?? s.viewerIsGuest,
      isPlaying: state.isPlaying,
      positionSec: state.positionSec,
      playbackUpdatedAt: state.playbackUpdatedAt,
      playbackChangedBy: state.playbackChangedBy ?? s.playbackChangedBy,
      playbackRevision: state.playbackRevision ?? s.playbackRevision,
      ended: state.ended ?? false,
      endedCode: state.ended ? state.code.toUpperCase() : null,
    })),

  setListenLocally: (listenLocally) => set({ listenLocally }),

  setStreamStatus: (streamStatus, streamError = null) => set({ streamStatus, streamError }),

  markEnded: (reason, endedCode) =>
    set((s) => ({
      ...INITIAL,
      ended: true,
      endedCode: (endedCode ?? s.code)?.toUpperCase() ?? null,
      endedReason: reason,
    })),

  clearParty: () => set({ ...INITIAL }),
}));

/** True when the current signed-in user in a Jam is allowed to control playback/queue order. */
export function canControlPartyPlayback(state: Pick<PartyStoreState, "active" | "isHost" | "guestsCanControl">): boolean {
  return !state.active || state.isHost || state.guestsCanControl;
}
