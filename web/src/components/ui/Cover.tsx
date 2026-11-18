"use client";

import { useState } from "react";
import CoverPlaceholder from "@/components/CoverPlaceholder";

/** Sources that have already been shown; they appear at once when mounted again. */
const shown = new Set<string>();

/**
 * The image is there (or failed, which the browser shows itself): let it be
 * seen. `arrived` marks an image the visitor was waiting for, which fades in.
 */
function reveal(image: HTMLImageElement, src: string, state: "true" | "arrived") {
  if (image.dataset.loaded === undefined) image.dataset.loaded = state;
  shown.add(src);
}

/**
 * Artwork tile with the branded placeholder as fallback. Size and rounding
 * come from `className` (e.g. "h-12 w-12 rounded-lg").
 *
 * A lazily loaded cover fades in once its image has arrived instead of popping
 * into the tile (`.cover-image` in globals.css). `eager` covers (the hero of a
 * page) are visible from the start and decode before they are painted, so a
 * hero that replaces its placeholder never shows an empty frame.
 */
export default function Cover({
  src,
  alt = "",
  className = "",
  eager = false,
  "data-traverse-card": traverseCard,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  eager?: boolean;
  /** Set by `Morph` around a card's cover; marks the element that travels on Back/Forward. */
  "data-traverse-card"?: string;
}) {
  // Decided once per mount, so a later render never cuts a running fade short.
  const [visible] = useState(() => eager || (!!src && shown.has(src)));
  if (!src) return <CoverPlaceholder className={`shrink-0 ${className}`} data-traverse-card={traverseCard} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding={eager ? "sync" : "async"}
      data-loaded={visible ? "true" : undefined}
      data-traverse-card={traverseCard}
      ref={(image) => {
        // Already complete when mounted (cached, or loaded before hydration): no load event will follow.
        if (image?.complete) reveal(image, src, "true");
      }}
      onLoad={(event) => reveal(event.currentTarget, src, "arrived")}
      onError={(event) => reveal(event.currentTarget, src, "arrived")}
      className={`cover-image shrink-0 object-cover ${className}`}
    />
  );
}
