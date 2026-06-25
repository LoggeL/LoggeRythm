import { create } from "zustand";
import type { PartyMember } from "@/types";

interface PartyStoreState {
  code: string | null;
  active: boolean;
  name: string;
  isHost: boolean;
  currentIndex: number;
  members: PartyMember[];

  setParty: (state: {
    code: string;
    active?: boolean;
    name: string;
    isHost: boolean;
    currentIndex: number;
    members: PartyMember[];
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

  setParty: (state) =>
    set({
      code: state.code,
      active: state.active ?? true,
      name: state.name,
      isHost: state.isHost,
      currentIndex: state.currentIndex,
      members: state.members,
    }),

  clearParty: () =>
    set({
      code: null,
      active: false,
      name: "",
      isHost: false,
      currentIndex: -1,
      members: [],
    }),
}));
