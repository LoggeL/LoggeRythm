"use client";

import type { LyricsData } from "@/hooks/useLyrics";

/**
 * Pill next to the "Lyrics" label: shows the ✦ AI badge and, when both a
 * provider text and a Whisper transcription exist, toggles between them.
 * Accent-filled while the AI variant is shown, muted outline otherwise,
 * pulsing while a transcription is still being generated.
 */
export default function LyricsVariantToggle({ lyrics }: { lyrics: LyricsData }) {
  const {
    variant,
    canToggle,
    autoAi,
    suspicion,
    aiLoading,
    aiFailed,
    toggleVariant,
    isAiGenerated,
  } = lyrics;

  // No provider text to toggle back to — plain badge when the only lyrics
  // are AI-generated, nothing otherwise.
  if (!canToggle) {
    if (!isAiGenerated) return null;
    return (
      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
        ✦ AI
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
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition ${
        showingAi || aiLoading
          ? "bg-accent/15 text-accent"
          : aiFailed
            ? "bg-red-500/15 text-red-400"
            : "bg-white/10 text-muted hover:text-foreground"
      } ${aiLoading ? "animate-pulse" : ""}`}
    >
      ✦ AI
    </button>
  );
}
