"use client";

import { useLayoutEffect, type RefObject } from "react";
import { fittedFontSize, headingWords } from "@/lib/fitWords";

/** Width of each word when set in `heading`'s own font, at its current size. */
function widestWordWidth(heading: HTMLElement, words: readonly string[]): number {
  const style = getComputedStyle(heading);
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:-99999px;top:0";
  // The `font` shorthand reads back empty when longhands like font-optical-sizing
  // are set, so copy every longhand that changes glyph widths.
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontSize = style.fontSize;
  probe.style.fontWeight = style.fontWeight;
  probe.style.fontStyle = style.fontStyle;
  probe.style.fontStretch = style.fontStretch;
  probe.style.fontKerning = style.fontKerning;
  probe.style.fontOpticalSizing = style.fontOpticalSizing;
  probe.style.letterSpacing = style.letterSpacing;
  probe.style.fontFeatureSettings = style.fontFeatureSettings;
  probe.style.fontVariationSettings = style.fontVariationSettings;
  probe.style.textTransform = style.textTransform;
  document.body.appendChild(probe);
  try {
    let widest = 0;
    for (const word of words) {
      probe.textContent = word;
      widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
    return widest;
  } finally {
    probe.remove();
  }
}

/**
 * Shrinks a display heading just enough that its widest word fits on one
 * line, so long single-word names are never broken mid-word. The stylesheet
 * keeps owning the natural size; this only ever sets a smaller inline size,
 * and re-fits when the heading's width or the loaded fonts change.
 */
export function useFitWords(ref: RefObject<HTMLElement | null>, text: string): void {
  useLayoutEffect(() => {
    const heading = ref.current;
    if (heading === null) throw new Error(`useFitWords: heading for "${text}" is not mounted`);
    const words = headingWords(text);

    const fit = () => {
      heading.style.fontSize = "";
      if (words.length === 0) return;
      const style = getComputedStyle(heading);
      const natural = parseFloat(style.fontSize);
      const available = heading.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const size = fittedFontSize(natural, available, widestWordWidth(heading, words));
      if (size !== natural) heading.style.fontSize = `${size}px`;
    };

    fit();
    let width = heading.clientWidth;
    const observer = new ResizeObserver(() => {
      // Only a new column width can change the fit; our own font change cannot.
      if (heading.clientWidth === width) return;
      width = heading.clientWidth;
      fit();
    });
    observer.observe(heading);
    let active = true;
    document.fonts.ready.then(() => {
      if (active) fit();
    });
    return () => {
      active = false;
      observer.disconnect();
      heading.style.fontSize = "";
    };
  }, [ref, text]);
}
