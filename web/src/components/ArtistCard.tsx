"use client";

import Link from "next/link";
import type { ArtistSummary } from "@/types";

export default function ArtistCard({ artist }: { artist: ArtistSummary }) {
  return (
    <Link
      href={`/artist/${artist.id}`}
      className="group block bg-panel hover:bg-panel-hover rounded-lg p-4 transition text-center"
    >
      {artist.picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artist.picture}
          alt={artist.name}
          className="w-full aspect-square object-cover rounded-full shadow-lg mb-3"
        />
      ) : (
        <div className="w-full aspect-square rounded-full bg-[#333] mb-3" />
      )}
      <div className="truncate font-semibold">{artist.name}</div>
      <div className="text-sm text-muted">Künstler</div>
    </Link>
  );
}
