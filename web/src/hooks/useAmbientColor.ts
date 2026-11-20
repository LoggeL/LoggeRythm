"use client";

import { useEffect } from "react";
import { usePlayerStore, currentTrack } from "@/store/player";
import { useCoverColors } from "@/hooks/useCoverColors";

/** Must match the resting `--ambient` in globals.css. */
const BRAND_AMBIENT = "170 204 60";

/**
 * Publishes the playing track's dominant artwork colour as the `--ambient`
 * CSS variable (an RGB triplet) so the shell can tint itself with the music.
 * Falls back to the muted brand lime while nothing plays or no colour is known.
 */
export function useAmbientColor(): void {
  const cover = usePlayerStore((s) => currentTrack(s)?.cover);
  const palette = useCoverColors(cover);
  useEffect(() => {
    const value = palette ? palette.rgb.map(Math.round).join(" ") : BRAND_AMBIENT;
    document.documentElement.style.setProperty("--ambient", value);
  }, [palette]);
}
