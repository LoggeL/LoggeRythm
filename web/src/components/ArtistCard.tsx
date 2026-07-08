"use client";

import Link from "next/link";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import type { ArtistSummary } from "@/types";

export default function ArtistCard({ artist }: { artist: ArtistSummary }) {
  return (
    <Link
      href={`/artist/${artist.id}`}
      className="group block bg-panel/70 hover:bg-panel-hover border border-white/5 rounded-2xl p-4 transition hover-lift text-center"
    >
      {artist.picture ? (
        <div className="mb-3 overflow-hidden rounded-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artist.picture}
            alt={artist.name}
            className="w-full aspect-square object-cover rounded-full shadow-lg transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      ) : (
        <CoverPlaceholder className="w-full aspect-square rounded-full mb-3" />
      )}
      <div className="truncate font-semibold">{artist.name}</div>
      <div className="text-sm text-muted">Künstler</div>
    </Link>
  );
}
