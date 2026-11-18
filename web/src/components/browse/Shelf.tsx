"use client";

import { Children, createContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

/**
 * Label of the shelf a card sits in ("" outside of one). Tells apart two cards
 * for the same album or artist in different shelves of one page, so only the
 * one that was opened takes part in the transition to its detail page.
 */
export const ShelfScope = createContext("");

const ITEM_WIDTHS = {
  /** Cover cards: album, artist, mix, playlist. */
  card: "w-[9.75rem] sm:w-44 xl:w-48",
  /** Text-led cards such as radio stations. */
  wide: "w-64 sm:w-72",
} as const;

export type ShelfSize = keyof typeof ITEM_WIDTHS;

// The fade only covers an edge that still hides content.
const EDGE_FADES = {
  none: "",
  start: "[mask-image:linear-gradient(to_right,transparent,black_2.5rem)]",
  end: "[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]",
  both: "[mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)]",
} as const;

const PAGER_CLASS =
  "absolute top-[calc(50%-2.25rem)] z-10 hidden h-10 w-10 place-items-center rounded-full bg-panel-hover text-foreground opacity-0 shadow-[var(--shadow-pop)] transition-opacity hover:bg-border focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/shelf:pointer-events-auto group-hover/shelf:opacity-100 md:grid pointer-events-none";

/**
 * One horizontally scrolling row of cards. Touch devices swipe (with scroll
 * snapping); pointer devices also get previous/next buttons that appear on
 * hover or keyboard focus. Each child becomes one fixed-width list item, so
 * the row keeps its height while its data loads into a `ShelfSkeleton`.
 */
export default function Shelf({ label, size = "card", children }: { label: string; size?: ShelfSize; children: ReactNode }) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [hidden, setHidden] = useState({ start: false, end: false });
  const items = Children.toArray(children);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) throw new Error(`Die Reihe "${label}" wurde nicht eingebunden.`);
    const measure = () => {
      const start = track.scrollLeft > 4;
      const end = track.scrollLeft < track.scrollWidth - track.clientWidth - 4;
      setHidden((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    track.addEventListener("scroll", measure, { passive: true });
    // Fires once on observe, then whenever the row is resized.
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => {
      track.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [label, items.length]);

  function page(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) throw new Error(`Die Reihe "${label}" wurde nicht eingebunden.`);
    track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: "smooth" });
  }

  const fade = hidden.start && hidden.end ? "both" : hidden.start ? "start" : hidden.end ? "end" : "none";

  return (
    <div className="group/shelf relative">
      {hidden.start && (
        <button type="button" onClick={() => page(-1)} aria-label={`${label}: zurück blättern`} className={`${PAGER_CLASS} -left-3`}>
          <ChevronLeftIcon width={20} height={20} />
        </button>
      )}
      <ul
        ref={trackRef}
        aria-label={label}
        className={`no-scrollbar -mx-1 flex snap-x snap-mandatory scroll-px-1 gap-1 overflow-x-auto overscroll-x-contain px-1 py-1 sm:gap-2 ${EDGE_FADES[fade]}`}
      >
        <ShelfScope value={label}>
          {items.map((item, index) => (
            <li key={index} className={`shrink-0 snap-start ${ITEM_WIDTHS[size]}`}>
              {item}
            </li>
          ))}
        </ShelfScope>
      </ul>
      {hidden.end && (
        <button type="button" onClick={() => page(1)} aria-label={`${label}: weiter blättern`} className={`${PAGER_CLASS} -right-3`}>
          <ChevronRightIcon width={20} height={20} />
        </button>
      )}
    </div>
  );
}

/** Placeholder row with the same item geometry as `Shelf`. */
export function ShelfSkeleton({ size = "card", count = 6, round = false }: { size?: ShelfSize; count?: number; round?: boolean }) {
  return (
    <div aria-hidden="true" className="-mx-1 flex gap-1 overflow-hidden px-1 py-1 sm:gap-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={`shrink-0 p-1.5 sm:p-2 ${ITEM_WIDTHS[size]}`}>
          <div className={`skeleton mb-3 w-full ${size === "wide" ? "aspect-[2/1] rounded-art" : round ? "aspect-square rounded-full" : "aspect-square rounded-art"}`} />
          <div className="skeleton my-[3px] h-3.5 w-3/4 rounded" />
          <div className="skeleton mb-[3px] mt-1.5 h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}
