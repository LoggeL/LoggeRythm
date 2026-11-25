"use client";

import { create } from "zustand";
import { readLocalJsonSnapshot, writeLocalJsonValue } from "@/hooks/useLocalJson";
import {
  INITIAL_VISUALIZER_PREFERENCES,
  VISUALIZER_PREFERENCES_KEY,
  nextCycledVisualizerPreferences,
  validateVisualizerPreferences,
  type VisualizerPreferences,
} from "@/lib/visualizerScenes";

interface UiModalsState {
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  toggleShortcuts: () => void;

  sleepTimerOpen: boolean;
  sleepTimerAnchor: HTMLElement | null;
  setSleepTimerOpen: (open: boolean, anchor?: HTMLElement | null) => void;

  audioEffectsOpen: boolean;
  audioEffectsAnchor: HTMLElement | null;
  setAudioEffectsOpen: (open: boolean, anchor?: HTMLElement | null) => void;

  cinemaMode: boolean;
  cinemaIdle: boolean;
  setCinemaMode: (cinema: boolean) => void;
  setCinemaIdle: (idle: boolean) => void;
  toggleCinemaMode: () => void;

  /** Cycle persisted visualizer preference directly (works even before NowPlaying mounts). */
  cycleVisualizer: () => VisualizerPreferences;
}

export const useUiModalsStore = create<UiModalsState>((set, get) => ({
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  toggleShortcuts: () => set({ shortcutsOpen: !get().shortcutsOpen }),

  sleepTimerOpen: false,
  sleepTimerAnchor: null,
  setSleepTimerOpen: (sleepTimerOpen, anchor = null) =>
    set({
      sleepTimerOpen,
      sleepTimerAnchor: sleepTimerOpen ? anchor : null,
      ...(sleepTimerOpen ? { audioEffectsOpen: false, audioEffectsAnchor: null } : {}),
    }),

  audioEffectsOpen: false,
  audioEffectsAnchor: null,
  setAudioEffectsOpen: (audioEffectsOpen, anchor = null) =>
    set({
      audioEffectsOpen,
      audioEffectsAnchor: audioEffectsOpen ? anchor : null,
      ...(audioEffectsOpen ? { sleepTimerOpen: false, sleepTimerAnchor: null } : {}),
    }),

  cinemaMode: false,
  cinemaIdle: false,
  setCinemaMode: (cinemaMode) => set({ cinemaMode, cinemaIdle: false }),
  setCinemaIdle: (cinemaIdle) => set({ cinemaIdle }),
  toggleCinemaMode: () => set({ cinemaMode: !get().cinemaMode, cinemaIdle: false }),

  cycleVisualizer: () => {
    const stored = readLocalJsonSnapshot<VisualizerPreferences>(
      VISUALIZER_PREFERENCES_KEY,
      INITIAL_VISUALIZER_PREFERENCES,
    );
    const valid = validateVisualizerPreferences(stored);
    const next = nextCycledVisualizerPreferences(valid);
    writeLocalJsonValue(VISUALIZER_PREFERENCES_KEY, next);
    return next;
  },
}));
