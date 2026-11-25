"use client";

import { create } from "zustand";
import {
  AUDIO_EFFECTS_STORAGE_KEY,
  DEFAULT_AUDIO_EFFECTS,
  EQ_BANDS,
  EQ_MAX_DB,
  EQ_MIN_DB,
  EQ_PRESET_GAINS,
  validateAudioEffects,
  type AudioEffectsSettings,
  type EqPresetKey,
} from "@/lib/audioEffects";
import { readLocalJsonSnapshot, writeLocalJsonValue } from "@/hooks/useLocalJson";

interface AudioEffectsState extends AudioEffectsSettings {
  hydrated: boolean;
  hydrate: () => void;
  setEqEnabled: (enabled: boolean) => void;
  applyPreset: (preset: Exclude<EqPresetKey, "custom">) => void;
  setBandGain: (index: number, db: number) => void;
  setCompressorEnabled: (enabled: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  reset: () => void;
}

function persistSettings(next: AudioEffectsSettings): void {
  if (typeof window === "undefined") return;
  writeLocalJsonValue(AUDIO_EFFECTS_STORAGE_KEY, validateAudioEffects(next));
}

function snapshot(state: AudioEffectsSettings): AudioEffectsSettings {
  return {
    eqEnabled: state.eqEnabled,
    preset: state.preset,
    bands: [...state.bands] as [number, number, number, number, number],
    compressorEnabled: state.compressorEnabled,
    playbackRate: state.playbackRate,
  };
}

export const useAudioEffectsStore = create<AudioEffectsState>((set, get) => ({
  ...DEFAULT_AUDIO_EFFECTS,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === "undefined") return;
    const raw = readLocalJsonSnapshot<unknown>(AUDIO_EFFECTS_STORAGE_KEY, null);
    if (raw === null) {
      set({ hydrated: true });
      return;
    }
    const validated = validateAudioEffects(raw);
    set({ ...validated, hydrated: true });
  },

  setEqEnabled: (eqEnabled) => {
    const next = { ...snapshot(get()), eqEnabled };
    persistSettings(next);
    set(next);
  },

  applyPreset: (preset) => {
    const gains = [...EQ_PRESET_GAINS[preset]] as [number, number, number, number, number];
    const next: AudioEffectsSettings = {
      ...snapshot(get()),
      eqEnabled: preset !== "flat",
      preset,
      bands: gains,
      compressorEnabled: preset === "late_night" ? true : get().preset === "late_night" ? false : get().compressorEnabled,
    };
    persistSettings(next);
    set(next);
  },

  setBandGain: (index, db) => {
    if (!Number.isInteger(index) || index < 0 || index >= EQ_BANDS.length) {
      throw new RangeError(`EQ band index ${index} is out of range.`);
    }
    const clamped = Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, Math.round(db * 2) / 2));
    const bands = [...get().bands] as [number, number, number, number, number];
    bands[index] = clamped;
    const next: AudioEffectsSettings = {
      ...snapshot(get()),
      eqEnabled: true,
      preset: "custom",
      bands,
    };
    persistSettings(next);
    set(next);
  },

  setCompressorEnabled: (compressorEnabled) => {
    const next = { ...snapshot(get()), compressorEnabled };
    persistSettings(next);
    set(next);
  },

  setPlaybackRate: (playbackRate) => {
    if (!Number.isFinite(playbackRate) || playbackRate < 0.5 || playbackRate > 2.5) {
      throw new RangeError(`Wiedergabegeschwindigkeit muss zwischen 0.5 und 2.5 liegen; erhalten: ${playbackRate}.`);
    }
    const next = { ...snapshot(get()), playbackRate };
    persistSettings(next);
    set(next);
  },

  reset: () => {
    const next: AudioEffectsSettings = {
      ...DEFAULT_AUDIO_EFFECTS,
      bands: [...DEFAULT_AUDIO_EFFECTS.bands] as [number, number, number, number, number],
    };
    persistSettings(next);
    set(next);
  },
}));
