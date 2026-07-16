import { create } from "zustand";
import type { Track } from "@/types";

interface AddToPlaylistState {
  /** The track being added, or null when the modal is closed. */
  track: Track | null;
  open: (track: Track) => void;
  close: () => void;
}

export const useAddToPlaylistStore = create<AddToPlaylistState>((set) => ({
  track: null,
  open: (track) => set({ track }),
  close: () => set({ track: null }),
}));

/** Open the "add to playlist" modal for a track (usable outside React). */
export function openAddToPlaylist(track: Track): void {
  useAddToPlaylistStore.getState().open(track);
}
