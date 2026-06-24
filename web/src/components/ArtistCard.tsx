"use client";

import Link from "next/link";
import type { ArtistSummary } from "@/types";

export default function ArtistCard({ artist }: { artist: ArtistSummary }) {
  return (
    <Link
      href={`/artist/${artist.id}`}
      className="group block bg-panel neon-glow border border-[var(--border)] rounded-xl p-4 text-center"
    >
      <div className="rounded-full p-[2px] mb-3 transition group-hover:bg-[var(--accent-grad)]">
        {artist.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artist.picture}
            alt={artist.name}
            className="w-full aspect-square object-cover rounded-full shadow-lg"
          />
        ) : (
          <div className="w-full aspect-square rounded-full bg-[#1a1330]" />
        )}
      </div>
      <div className="truncate font-semibold">{artist.name}</div>
      <div className="text-sm text-muted">Künstler</div>
    </Link>
  );
}
