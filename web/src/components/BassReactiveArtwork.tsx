"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePlayerStore } from "@/store/player";
import { subscribeAudioSpectrum } from "@/lib/audioSpectrum";
import { approachArtworkPulse, artworkPulseStyle, artworkPulseTarget } from "@/lib/artworkPulse";

/** The inner artwork moves; its parent's dimensions remain the visualizer anchor. */
export default function BassReactiveArtwork({ children, className = "" }: { children: ReactNode; className?: string }) {
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const frameRef = useRef<HTMLDivElement>(null);
  const playingRef = useRef(isPlaying);
  const syncRef = useRef<(() => void) | null>(null);
  useEffect(() => { playingRef.current = isPlaying; syncRef.current?.(); }, [isPlaying]);

  useEffect(() => {
    const artwork = frameRef.current;
    if (!artwork || !artwork.parentElement) throw new Error("Bass-reactive artwork requires a mounted inner frame and stable outer anchor.");
    const frame = artwork;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    let visible = document.visibilityState === "visible";
    let intersects = false;
    let level = 0;
    let unsubscribe: (() => void) | null = null;

    function draw() {
      const style = artworkPulseStyle(level);
      frame.style.transform = style.transform;
      frame.style.boxShadow = style.boxShadow;
      frame.dataset.bassLevel = level.toFixed(4);
    }
    function reset(animate: boolean) {
      level = 0;
      frame.style.transition = animate ? "transform 180ms ease-out, box-shadow 180ms ease-out" : "none";
      frame.style.willChange = "auto";
      draw();
    }
    function sync() {
      const eligible = playingRef.current && visible && intersects && !reduced;
      if (eligible && !unsubscribe) {
        unsubscribe = subscribeAudioSpectrum((spectrum) => {
          if (!spectrum.active) { reset(true); return; }
          level = approachArtworkPulse(level, artworkPulseTarget(spectrum.bass, spectrum.onset), spectrum.deltaSeconds);
          frame.style.transition = "none";
          frame.style.willChange = "transform";
          draw();
        });
      } else if (!eligible) {
        unsubscribe?.();
        unsubscribe = null;
        reset(visible && intersects && !reduced);
      }
    }
    function onVisibility() { visible = document.visibilityState === "visible"; sync(); }
    function onMotion(event: MediaQueryListEvent) { reduced = event.matches; sync(); }
    const observer = new IntersectionObserver(([entry]) => { intersects = entry.isIntersecting; sync(); }, { threshold: 0.01 });
    observer.observe(artwork.parentElement);
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener("change", onMotion);
    syncRef.current = sync;
    reset(false);
    return () => {
      syncRef.current = null;
      unsubscribe?.();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
      reset(false);
    };
  }, []);

  return <div ref={frameRef} data-bass-reactive-artwork className={`h-full w-full overflow-hidden rounded-[inherit] ${className}`}>{children}</div>;
}
