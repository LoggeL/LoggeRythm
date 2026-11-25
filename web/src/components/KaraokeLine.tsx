"use client";

import { wordKaraokeProgress } from "@/lib/audioIntelligence";
import type { LyricsLine } from "@/types";

/**
 * Renders a lyric line with smooth word-by-word karaoke fill whenever the line
 * carries `words: [{ t, end, text }]` (from Whisper `groq-word-v3`), or clean
 * static text otherwise.
 */
export default function KaraokeLine({
  line,
  isActive,
  isPast,
  currentTime,
}: {
  line: LyricsLine;
  isActive: boolean;
  isPast: boolean;
  currentTime: number;
}) {
  const words = line.words;
  if (!words || words.length === 0) {
    return <>{line.text || "♪"}</>;
  }
  if (!isActive) {
    return <>{line.text || "♪"}</>;
  }

  return (
    <span className="inline">
      {words.map((word, idx) => {
        const progress = wordKaraokeProgress(word, currentTime);
        const pct = Math.round(progress * 100);
        const sep = idx < words.length - 1 ? " " : "";
        if (progress <= 0 && !isPast) {
          return (
            <span key={`${word.t}-${idx}`} className="text-foreground/38">
              {word.text}
              {sep}
            </span>
          );
        }
        if (progress >= 1) {
          return (
            <span key={`${word.t}-${idx}`} className="text-foreground">
              {word.text}
              {sep}
            </span>
          );
        }
        return (
          <span key={`${word.t}-${idx}`}>
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: `linear-gradient(90deg, var(--foreground) 0%, var(--foreground) ${pct}%, rgb(244 240 230 / 0.36) ${pct}%, rgb(244 240 230 / 0.36) 100%)`,
              }}
            >
              {word.text}
            </span>
            {sep}
          </span>
        );
      })}
    </span>
  );
}
