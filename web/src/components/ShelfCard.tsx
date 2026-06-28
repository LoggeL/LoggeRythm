"use client";

import type { HomeShelf } from "@/types";
import { usePlayerStore } from "@/store/player";
import { PlayIcon } from "@/components/icons";

// Per-collection theme gradient (mirrors the mockup's colourful chart cards).
const THEME_BY_KEY: Record<string, string> = {
  "top-global": "gradient-violet",
  pop: "gradient-red",
  hiphop: "gradient-orange",
  rock: "gradient-pink",
  electro: "gradient-blue",
  weekly: "gradient-violet",
  chill: "gradient-aurora",
  discover: "gradient-blue",
  top: "gradient-violet",
};
const FALLBACK = ["gradient-violet", "gradient-aurora", "gradient-blue", "gradient-red", "gradient-orange"];

// Short uppercase tag shown on the wide "Für dich" hero cards.
const TAG_BY_KEY: Record<string, string> = {
  weekly: "Wöchentlich",
  chill: "Entspannt",
  discover: "Neu",
};

function themeFor(shelf: HomeShelf, index: number): string {
  return THEME_BY_KEY[shelf.key] ?? FALLBACK[index % FALLBACK.length];
}

/**
 * A curated shelf rendered as a designed card. `variant="hero"` is the wide
 * split card used for "Für dich" mixes (text left, gradient art right);
 * `variant="collection"` is the colourful chart tile. Clicking plays the shelf.
 */
export default function ShelfCard({
  shelf,
  index = 0,
  variant = "collection",
}: {
  shelf: HomeShelf;
  index?: number;
  variant?: "hero" | "collection";
}) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const theme = themeFor(shelf, index);

  function play() {
    if (shelf.tracks.length) playQueue(shelf.tracks, 0);
  }

  if (variant === "hero") {
    const tag = TAG_BY_KEY[shelf.key];
    return (
      <button
        type="button"
        onClick={play}
        className="group relative flex w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.055] shadow-xl shadow-black/15 hover-lift min-h-[168px]"
      >
        {/* Gradient art on the right half (optionally tinted by the cover). */}
        <div className="absolute inset-y-0 right-0 w-3/5 overflow-hidden rounded-r-2xl">
          {shelf.cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shelf.cover}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-95 transition-transform duration-500 group-hover:scale-105"
            />
          )}
          <div className={`absolute inset-0 ${theme} ${shelf.cover ? "opacity-45 mix-blend-soft-light" : ""}`} />
          <div className="absolute inset-0 bg-gradient-to-r from-[#151520] via-[#151520]/75 to-transparent" />
        </div>
        {/* Text + play on the left. */}
        <div className="relative z-10 p-5 flex flex-col gap-1 max-w-[62%] text-left">
          {tag && (
            <span className="text-[10px] uppercase tracking-widest text-accent-soft font-bold">
              {tag}
            </span>
          )}
          <h3 className="text-xl font-extrabold drop-shadow">{shelf.title}</h3>
          {shelf.subtitle && (
            <p className="text-sm text-muted line-clamp-2">{shelf.subtitle}</p>
          )}
          <span className="mt-3 w-11 h-11 rounded-full bg-white text-black flex items-center justify-center shadow-lg transition group-hover:scale-105">
            <PlayIcon width={20} height={20} />
          </span>
        </div>
      </button>
    );
  }

  // collection
  return (
    <button
      type="button"
      onClick={play}
        className={`group relative block w-full overflow-hidden rounded-2xl aspect-[4/3] text-left border border-white/10 shadow-xl shadow-black/15 hover-lift ${theme}`}
    >
      {shelf.cover && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shelf.cover}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-70 mix-blend-soft-light transition-transform duration-500 group-hover:scale-105"
          />
        </>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
      <div className="absolute inset-0 p-4 flex flex-col">
        <h3 className="text-base sm:text-lg font-extrabold leading-tight drop-shadow">
          {shelf.title}
        </h3>
        {shelf.subtitle && (
          <p className="text-xs text-white/80 mt-1 line-clamp-2 max-w-[85%]">
            {shelf.subtitle}
          </p>
        )}
      </div>
      <span className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition">
        <PlayIcon width={18} height={18} />
      </span>
    </button>
  );
}
