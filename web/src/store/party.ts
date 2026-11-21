import { create } from "zustand";
import type { PartyListenMode } from "@/app/party/listenMode";
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

  /** Where this browser hears the party; reset to `device` for each new party. */
  listenMode: PartyListenMode;
  setListenMode: (mode: PartyListenMode) => void;

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

export const usePartyStore = create<PartyStoreState>((set, get) => ({
  code: null,
  active: false,
  name: "",
  isHost: false,
  currentIndex: -1,
  members: [],
  isPlaying: false,
  positionSec: 0,
  playbackUpdatedAt: null,
  listenMode: "device",

  setListenMode: (mode) => {
    const { code, isHost } = get();
    if (code === null) throw new Error("No party is open; there is nowhere to listen.");
    if (isHost && mode !== "device") {
      throw new Error("The host plays the party in this browser and cannot listen elsewhere.");
    }
    set({ listenMode: mode });
  },

  setParty: (state) =>
    set((current) => ({
      ...(current.code === state.code ? {} : { listenMode: "device" as const }),
      code: state.code,
      active: state.active ?? true,
      name: state.name,
      isHost: state.isHost,
      currentIndex: state.currentIndex,
      members: state.members,
      isPlaying: state.isPlaying,
      positionSec: state.positionSec,
      playbackUpdatedAt: state.playbackUpdatedAt,
    })),

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
      listenMode: "device",
    }),
}));
