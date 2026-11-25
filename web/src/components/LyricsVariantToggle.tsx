"use client";

import type { LyricsData } from "@/hooks/useLyrics";

const BADGE = "rounded-full px-2 py-0.5 text-[10px] font-bold";

/**
 * Pill next to the "Songtext" label: marks AI-transcribed lyrics and, when
 * both a provider text and a transcription exist, toggles between them.
 * Tinted while the AI variant is shown, pulsing while it is being generated.
 */
export default function LyricsVariantToggle({ lyrics }: { lyrics: LyricsData }) {
  const { variant, canToggle, autoAi, suspicion, aiLoading, aiFailed, toggleVariant, isAiGenerated } = lyrics;

  // No provider text to toggle back to: a plain badge when the only lyrics
  // are AI-generated, nothing otherwise.
  if (!canToggle) {
    if (!isAiGenerated) return null;
    return (
      <span title="KI-Transkription" className={`${BADGE} border border-accent/40 bg-[#0f0e11]/75 text-accent-soft`}>
        ✦ KI
      </span>
    );
  }

  const showingAi = variant === "ai";
  const title = aiFailed
    ? "KI-Transkription fehlgeschlagen"
    : aiLoading
      ? "KI-Transkription wird erstellt…"
      : showingAi
        ? autoAi
          ? `Automatisch zur KI-Transkription gewechselt (${suspicion}) – tippen für Original`
          : "Original-Songtext anzeigen"
        : "KI-Transkription anzeigen";

  return (
    <button
      type="button"
      onClick={toggleVariant}
      title={title}
      aria-label={title}
      aria-pressed={showingAi}
      className={`${BADGE} relative border transition-colors before:absolute before:-inset-3 before:content-[''] ${
        showingAi || aiLoading
          ? "border-accent/40 bg-[#0f0e11]/75 text-accent-soft"
          : aiFailed
            ? "border-danger/40 bg-[#1a1114]/80 text-danger"
            : "border-white/14 bg-[#0f0e11]/70 text-foreground/80 hover:text-foreground"
      } ${aiLoading ? "animate-pulse motion-reduce:animate-none" : ""}`}
    >
      ✦ KI
    </button>
  );
}
