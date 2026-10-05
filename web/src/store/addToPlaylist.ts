import { create } from "zustand";
import type { Track } from "@/types";

interface AddToPlaylistState {
  /** The track being added, or null when the modal is closed. */
  track: Track | null;
  /** Distinguish reopened dialogs even when they use the same track object. */
  session: number;
  open: (track: Track) => void;
  close: () => void;
}

export const useAddToPlaylistStore = create<AddToPlaylistState>((set) => ({
  track: null,
  session: 0,
  open: (track) => set((state) => ({ track, session: state.session + 1 })),
  close: () => set((state) => ({ track: null, session: state.session + 1 })),
}));

/** Open the "add to playlist" modal for a track (usable outside React). */
export function openAddToPlaylist(track: Track): void {
  useAddToPlaylistStore.getState().open(track);
}
