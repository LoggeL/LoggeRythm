"use client";

import Link from "next/link";
import Cover from "@/components/ui/Cover";
import { PlayIcon } from "@/components/icons";
import { trackArtistLabel } from "@/lib/trackArtists";
import type { ArtistSummary, Track } from "@/types";
import type { TopHit as TopHitResult } from "../results";

const CARD = "group relative flex min-h-48 w-full flex-1 flex-col justify-end rounded-xl bg-panel p-5 text-left transition-colors hover:bg-panel-hover";
const KIND = "rounded-full bg-backdrop/70 px-2.5 py-1 text-[11px] font-bold";

/** Feature card for the best match: opens the artist or plays the track. */
export default function TopHit({ hit, onPlay, onOpen }: { hit: TopHitResult<Track, ArtistSummary>; onPlay: (index: number) => void; onOpen: () => void }) {
  if (hit.kind === "artist") {
    return (
      <Link href={`/artist/${hit.artist.id}`} onClick={onOpen} className={CARD}>
        <Cover src={hit.artist.picture} className="mb-5 h-24 w-24 rounded-full shadow-lg sm:h-28 sm:w-28" eager />
        <span className="font-display line-clamp-2 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{hit.artist.name}</span>
        <span className="mt-3 flex">
          <span className={KIND}>Künstler</span>
        </span>
      </Link>
    );
  }
  const { track } = hit;
  return (
    <button type="button" onClick={() => onPlay(hit.index)} aria-label={`${track.title} von ${trackArtistLabel(track)} abspielen`} className={CARD}>
      <Cover src={track.cover} className="mb-5 h-24 w-24 rounded-lg shadow-lg sm:h-28 sm:w-28" eager />
      <span className="font-display line-clamp-2 max-w-[calc(100%-4rem)] text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{track.title}</span>
      <span className="mt-3 flex min-w-0 max-w-[calc(100%-4rem)] items-center gap-2 text-sm text-muted">
        <span className={`${KIND} shrink-0 text-foreground`}>Titel</span>
        <span className="truncate">{trackArtistLabel(track)}</span>
      </span>
      <span aria-hidden="true" className="play-fab absolute bottom-5 right-5 h-12 w-12">
        <PlayIcon width={20} height={20} />
      </span>
    </button>
  );
}
