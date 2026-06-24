"use client";

import Link from "next/link";
import type { AlbumSummary } from "@/types";

export default function AlbumCard({ album }: { album: AlbumSummary }) {
  const year = album.release_date ? album.release_date.slice(0, 4) : "";
  return (
    <Link
      href={`/album/${album.id}`}
      className="group block bg-panel hover:bg-panel-hover rounded-lg p-4 transition hover-lift"
    >
      {album.cover ? (
        <div className="mb-3 overflow-hidden rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={album.cover}
            alt={album.title}
            className="w-full aspect-square object-cover rounded-md shadow-lg transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      ) : (
        <div className="w-full aspect-square rounded-md bg-[#333] mb-3" />
      )}
      <div className="truncate font-semibold">{album.title}</div>
      <div className="truncate text-sm text-muted">
        {[year, album.artist].filter(Boolean).join(" · ")}
      </div>
    </Link>
  );
}
