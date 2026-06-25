import { create } from "zustand";

interface PartyStoreState {
  code: string | null;
  active: boolean;
  name: string;
  isHost: boolean;
  currentIndex: number;
  members: string[];

  setParty: (state: {
    code: string;
    active?: boolean;
    name: string;
    isHost: boolean;
    currentIndex: number;
    members: string[];
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
