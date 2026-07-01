"use client";

import Link from "next/link";
import type { Track } from "@/types";

/**
 * A track title that links to its album when known, otherwise plain text.
 * Used everywhere a track is listed so titles are consistently clickable.
 */
export default function TrackTitle({
  track,
  className,
  onNavigate,
}: {
  track: Track;
  className?: string;
  onNavigate?: () => void;
}) {
  if (track.album_id) {
    return (
      <Link
        href={`/album/${track.album_id}`}
        onClick={onNavigate}
        className={className}
      >
        {track.title}
      </Link>
    );
  }
  return <span className={className}>{track.title}</span>;
}
