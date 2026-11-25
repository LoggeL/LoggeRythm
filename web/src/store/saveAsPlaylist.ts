"use client";

import { create } from "zustand";
import type { Track } from "@/types";

export interface SaveAsPlaylistDraft {
  defaultName: string;
  description?: string;
  tracks: Track[];
}

interface SaveAsPlaylistState {
  draft: SaveAsPlaylistDraft | null;
  session: number;
  open: (draft: SaveAsPlaylistDraft) => void;
  close: () => void;
}

export const useSaveAsPlaylistStore = create<SaveAsPlaylistState>((set) => ({
  draft: null,
  session: 0,
  open: (draft) => {
    if (!Array.isArray(draft.tracks) || draft.tracks.length === 0) {
      throw new Error("Es sind keine Titel zum Speichern als Playlist vorhanden.");
    }
    set((state) => ({
      draft: {
        defaultName: draft.defaultName,
        description: draft.description,
        tracks: draft.tracks.map((track) => ({ ...track })),
      },
      session: state.session + 1,
    }));
  },
  close: () => set({ draft: null }),
}));

export function openSaveAsPlaylist(draft: SaveAsPlaylistDraft): void {
  useSaveAsPlaylistStore.getState().open(draft);
}
