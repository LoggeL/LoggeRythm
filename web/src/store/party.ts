import { create } from "zustand";
import type { PartyMember } from "@/types";

interface PartyStoreState {
  code: string | null;
  active: boolean;
  name: string;
  isHost: boolean;
  currentIndex: number;
  members: PartyMember[];

  // Host-authoritative playback state (mirrored from the SSE stream). Guests
  // follow these; the host owns them.
  isPlaying: boolean;
  positionSec: number;
  /** epoch ms of the last playback update, or null if never set. */
  playbackUpdatedAt: number | null;

  setParty: (state: {
    code: string;
    active?: boolean;
    name: string;
    isHost: boolean;
    currentIndex: number;
    members: PartyMember[];
    isPlaying: boolean;
    positionSec: number;
    playbackUpdatedAt: number | null;
  }) => void;
  clearParty: () => void;
}

export const usePartyStore = create<PartyStoreState>((set) => ({
  code: null,
  active: false,
  name: "",
  isHost: false,
  currentIndex: -1,
  members: [],
  isPlaying: false,
  positionSec: 0,
  playbackUpdatedAt: null,

  setParty: (state) =>
    set({
      code: state.code,
      active: state.active ?? true,
      name: state.name,
      isHost: state.isHost,
      currentIndex: state.currentIndex,
      members: state.members,
      isPlaying: state.isPlaying,
      positionSec: state.positionSec,
      playbackUpdatedAt: state.playbackUpdatedAt,
    }),

  clearParty: () =>
    set({
      code: null,
      active: false,
      name: "",
      isHost: false,
      currentIndex: -1,
      members: [],
      isPlaying: false,
      positionSec: 0,
      playbackUpdatedAt: null,
    }),
}));
