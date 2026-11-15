"use client";

import Cover from "@/components/ui/Cover";
import { PlayIcon } from "@/components/icons";

/** Compact "jump back in" tile: artwork, title, and play on click. */
export default function QuickTile({ title, subtitle, cover, onPlay }: { title: string; subtitle: string; cover?: string | null; onPlay: () => void }) {
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`${title} von ${subtitle} abspielen`}
      className="group press flex h-14 min-w-0 items-center gap-3 overflow-hidden rounded-[var(--radius-art)] border border-hairline bg-foreground/[0.04] pr-2 text-left hover:border-foreground/20 hover:bg-foreground/[0.09] sm:h-16 sm:pr-3"
    >
      <Cover src={cover} className="h-14 w-14 sm:h-16 sm:w-16" />
      <span className="min-w-0 flex-1">
        <span className="font-display line-clamp-2 text-[13px] font-bold leading-snug tracking-tight sm:line-clamp-1 sm:text-[15px]">{title}</span>
        <span className="hidden truncate text-xs text-muted sm:block">{subtitle}</span>
      </span>
      <span aria-hidden="true" className="play-fab hidden h-10 w-10 opacity-0 transition-opacity group-hover:opacity-100 sm:grid">
        <PlayIcon width={18} height={18} />
      </span>
    </button>
  );
}
