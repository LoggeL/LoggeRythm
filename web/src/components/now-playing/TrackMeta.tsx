"use client";

import type { Track } from "@/types";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import LikeButton from "@/components/LikeButton";
import TrackMenu from "@/components/TrackMenu";
import Cover from "@/components/ui/Cover";

/**
 * Title and artist of the playing track. `display` is the large, centred
 * heading under the artwork; `row` is the compact line above the transport
 * (optionally with a thumbnail when the artwork itself is not on screen).
 */
export function TrackHeading({
  track,
  onNavigate,
  variant,
  thumbnail = false,
}: {
  track: Track;
  onNavigate: () => void;
  variant: "display" | "row";
  thumbnail?: boolean;
}) {
  if (variant === "display") {
    return (
      <div className="min-w-0 text-center">
        <TrackTitle
          track={track}
          onNavigate={onNavigate}
          className="font-display line-clamp-2 text-[clamp(2rem,3.4vw,3.5rem)] font-extrabold leading-[1.02] tracking-[-0.04em] hover:underline"
        />
        <ArtistLinks
          track={track}
          onNavigate={onNavigate}
          className="mt-2 block truncate text-lg text-muted xl:text-xl"
          linkClassName="hover:text-foreground hover:underline"
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5">
      {thumbnail && <Cover src={track.cover} className="h-12 w-12 rounded-[var(--radius-art)]" eager />}
      <div className="min-w-0 flex-1">
        <TrackTitle track={track} onNavigate={onNavigate} className="font-display block truncate text-xl font-bold tracking-tight hover:underline" />
        <ArtistLinks track={track} onNavigate={onNavigate} className="block truncate text-sm text-muted" linkClassName="hover:text-foreground hover:underline" />
      </div>
      <LikeButton key={track.id} track={track} />
      <TrackMenu track={track} />
    </div>
  );
}
