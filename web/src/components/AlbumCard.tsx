"use client";

import Link from "next/link";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import type { AlbumSummary } from "@/types";

export default function AlbumCard({ album }: { album: AlbumSummary }) {
  const year = album.release_date ? album.release_date.slice(0, 4) : "";
  return (
    <Link
      href={`/album/${album.id}`}
      className="group block bg-panel/70 hover:bg-panel-hover border border-white/5 rounded-2xl p-4 transition hover-lift"
    >
      {album.cover ? (
        <div className="mb-3 overflow-hidden rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={album.cover}
            alt={album.title}
            className="w-full aspect-square object-cover rounded-xl shadow-lg transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      ) : (
        <CoverPlaceholder className="w-full aspect-square rounded-xl mb-3" />
      )}
      <div className="truncate font-semibold">{album.title}</div>
      <div className="truncate text-sm text-muted">
        {[year, album.artist].filter(Boolean).join(" · ")}
      </div>
    </Link>
  );
}
