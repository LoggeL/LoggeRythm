import type { LyricsLine } from "@/types";

const AI_LINE_MAX_LENGTH = 64;

function splitText(text: string): string[] {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= AI_LINE_MAX_LENGTH) return [normalized];

  const chunks: string[] = [];
  let current = "";
  for (const word of normalized.split(" ")) {
    if (word.length > AI_LINE_MAX_LENGTH) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let start = 0; start < word.length; start += AI_LINE_MAX_LENGTH) {
        chunks.push(word.slice(start, start + AI_LINE_MAX_LENGTH));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= AI_LINE_MAX_LENGTH) {
      current = candidate;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Break verbose transcription segments into readable lyric lines. Generated
 * timestamps are distributed across the segment's original time window so
 * every new line becomes active in order instead of all highlighting at once.
 */
export function splitAiLyrics(lines: LyricsLine[]): LyricsLine[] {
  return lines.flatMap((line, index) => {
    const chunks = splitText(line.text);
    if (chunks.length === 1) return [line];

    const nextTime = lines[index + 1]?.t;
    const estimatedDuration = Math.max(2.4, line.text.split(/\s+/).length / 2.5);
    const duration =
      nextTime !== undefined && nextTime > line.t
        ? nextTime - line.t
        : estimatedDuration;

    return chunks.map((text, chunkIndex) => ({
      t: line.t + (duration * chunkIndex) / chunks.length,
      text,
    }));
  });
}
