"use client";

import { useState } from "react";
import Link from "next/link";
import { useMe } from "@/hooks/useAuth";
import { useLikes, usePlaylists } from "@/hooks/useLibrary";
import { useFollowing } from "@/hooks/useFollows";
import { playlistPath } from "@/lib/slugs";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import ArtistCard from "@/components/ArtistCard";
import { RowListSkeleton } from "@/components/Skeleton";
import { HeartIcon } from "@/components/icons";

type Tab = "playlists" | "liked" | "following";

export default function LibraryPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const { data: likes, isLoading: likesLoading } = useLikes(!!me);
  const { data: playlists } = usePlaylists(!!me);
  const { data: following } = useFollowing(!!me);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [tab, setTab] = useState<Tab>("playlists");

  if (meLoading) return <RowListSkeleton />;

  if (!me) {
    return (
      <div>
        <h1 className="text-3xl font-extrabold mb-3">Deine Bibliothek</h1>
        <p className="text-muted mb-4">
          Melde dich an, um deine gelikten Titel und Playlists zu sehen.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 rounded-full bg-accent text-white hover:bg-accent-hover"
        >
          Anmelden
        </Link>
      </div>
    );
  }

  const tracks = likes ?? [];
  const TABS: { key: Tab; label: string }[] = [
    { key: "playlists", label: "Playlists" },
    { key: "liked", label: "Gelikte Titel" },
    { key: "following", label: "Gefolgt" },
  ];

  return (
    <div className="animate-in">
      <h1 className="text-3xl font-extrabold mb-4">Deine Bibliothek</h1>

      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              tab === t.key
                ? "bg-foreground text-background"
                : "bg-panel text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "playlists" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <button
            type="button"
            onClick={() => setTab("liked")}
            className="hover-lift text-left bg-accent rounded-lg p-4 transition"
          >
            <div className="w-full aspect-square rounded-md bg-white/10 flex items-center justify-center mb-3">
              <HeartIcon filled width={40} height={40} className="text-white" />
            </div>
            <div className="font-semibold">Gelikte Titel</div>
            <div className="text-sm text-white/70">{tracks.length} Titel</div>
          </button>

          {(playlists ?? []).map((p) => (
            <Link
              key={String(p.id)}
              href={playlistPath(p)}
              className="hover-lift bg-panel hover:bg-panel-hover rounded-lg p-4 transition"
            >
              {p.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.cover_url}
                  alt={p.name}
                  className="w-full aspect-square object-cover rounded-md shadow-lg mb-3"
                />
              ) : (
                <div className="w-full aspect-square rounded-md bg-panel-hover flex items-center justify-center text-4xl mb-3">
                  ♪
                </div>
              )}
              <div className="truncate font-semibold">{p.name}</div>
              <div className="truncate text-sm text-muted">
                Playlist · {p.track_count} Titel
              </div>
            </Link>
          ))}
        </div>
      )}

      {tab === "liked" && (
        <>
          <p className="text-muted mb-4">Gelikte Titel · {tracks.length}</p>
          {likesLoading && <RowListSkeleton />}
          {!likesLoading && tracks.length === 0 && (
            <p className="text-muted">Du hast noch keine Titel geliked.</p>
          )}
          <div className="flex flex-col">
            {tracks.map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                index={i}
                onPlay={() => playQueue(tracks, i)}
              />
            ))}
          </div>
        </>
      )}

      {tab === "following" && (
        <>
          {(following ?? []).length === 0 ? (
            <p className="text-muted">Du folgst noch keinen Künstlern.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {(following ?? []).map((a) => (
                <ArtistCard key={String(a.id)} artist={a} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
