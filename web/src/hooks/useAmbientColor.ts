"use client";

import { useEffect } from "react";
import { usePlayerStore, currentTrack } from "@/store/player";
import { useCoverColors } from "@/hooks/useCoverColors";

const BRAND_AMBIENT = "124 92 255";

/**
 * Publishes the playing track's dominant artwork colour as the `--ambient`
 * CSS variable (an RGB triplet) so the shell can tint itself with the music.
 * Falls back to the brand violet while nothing plays or no colour is known.
 */
export function useAmbientColor(): void {
  const cover = usePlayerStore((s) => currentTrack(s)?.cover);
  const palette = useCoverColors(cover);
  useEffect(() => {
    const value = palette ? palette.rgb.map(Math.round).join(" ") : BRAND_AMBIENT;
    document.documentElement.style.setProperty("--ambient", value);
  }, [palette]);
}
