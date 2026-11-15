"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Keeps the active lyric line vertically centred in its scroller. The first
 * positioning happens before paint (no visible jump when the view opens);
 * later line changes scroll smoothly.
 */
export function useActiveLineScroll(active: number, lineCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const positioned = useRef(false);

  useLayoutEffect(() => {
    const line = activeRef.current;
    const container = scrollRef.current;
    if (!line || !container) return;

    const position = () => {
      if (container.clientHeight === 0) return false;
      const top = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2;
      if (positioned.current) {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        container.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
      } else {
        container.scrollTop = top;
        positioned.current = true;
      }
      return true;
    };

    if (position()) return;
    const observer = new ResizeObserver(() => {
      if (position()) observer.disconnect();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, lineCount]);

  return { scrollRef, activeRef };
}
