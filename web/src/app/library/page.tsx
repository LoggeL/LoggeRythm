"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMe } from "@/hooks/useAuth";
import { useLikes, usePlaylists } from "@/hooks/useLibrary";
import { useFollowing } from "@/hooks/useFollows";
import { RowListSkeleton } from "@/components/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import QueryError from "@/components/ui/QueryError";
import { LibraryIcon, PlusIcon } from "@/components/icons";
import CreatePlaylistDialog from "./CreatePlaylistDialog";
import { libraryTabFromParam, libraryTabHref, type LibraryTab } from "./navigation";
import PlaylistsTab from "./_tabs/PlaylistsTab";
import PlaylistInvitations from "./_tabs/PlaylistInvitations";
import LikedTab from "./_tabs/LikedTab";
import FollowingTab from "./_tabs/FollowingTab";
import RecentTab from "./_tabs/RecentTab";
import DownloadsTab from "./_tabs/DownloadsTab";

const TABS: { key: LibraryTab; label: string }[] = [
  { key: "playlists", label: "Playlists" },
  { key: "liked", label: "Gelikte Titel" },
  { key: "following", label: "Künstler" },
  { key: "recent", label: "Verlauf" },
  { key: "downloads", label: "Downloads" },
];

function LibraryLoading() {
  return (
    <div role="status" aria-label="Bibliothek wird geladen">
      <RowListSkeleton />
    </div>
  );
}

function LibraryContent() {
  const searchParams = useSearchParams();
  const tab = libraryTabFromParam(searchParams.get("tab"));
  const tabHref = (next: LibraryTab) => libraryTabHref(searchParams.toString(), next);
  const meQuery = useMe();
  const { data: me } = meQuery;
  // Each collection is requested only while its tab is open.
  const likesQuery = useLikes(!!me && tab === "liked");
  const playlistsQuery = usePlaylists(!!me && tab === "playlists");
  const followingQuery = useFollowing(!!me && tab === "following");
  const [creating, setCreating] = useState(false);

  if (meQuery.isLoading) return <LibraryLoading />;
  if (meQuery.isError && !me) return <QueryError label="Deine Kontodaten" query={meQuery} />;
  if (!me) {
    return (
      <div className="flex flex-col gap-7">
        <h1 className="page-title">Bibliothek</h1>
        <EmptyState
          icon={<LibraryIcon width={24} height={24} />}
          title="Deine Sammlung wartet auf dich"
          action={
            <Link href="/login" className="action-primary">
              Anmelden
            </Link>
          }
        >
          Melde dich an, um deine gelikten Titel und Playlists zu sehen.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="page-title">Bibliothek</h1>
          <button type="button" className="action-primary" onClick={() => setCreating(true)}>
            <PlusIcon width={18} height={18} />
            Playlist erstellen
          </button>
        </div>
        <QueryError label="Deine Kontodaten" query={meQuery} />
        <nav aria-label="Bibliotheksbereiche" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
          {TABS.map((item) => (
            <Link
              key={item.key}
              href={tabHref(item.key)}
              scroll={false}
              aria-current={tab === item.key ? "page" : undefined}
              className="filter-chip shrink-0 max-sm:min-h-11"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {tab === "playlists" && <PlaylistInvitations />}
      {tab === "playlists" && <PlaylistsTab query={playlistsQuery} likedHref={tabHref("liked")} onCreate={() => setCreating(true)} />}
      {tab === "liked" && <LikedTab query={likesQuery} />}
      {tab === "following" && <FollowingTab query={followingQuery} />}
      {tab === "recent" && <RecentTab />}
      {tab === "downloads" && <DownloadsTab playlistsHref={tabHref("playlists")} />}

      <CreatePlaylistDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<LibraryLoading />}>
      <LibraryContent />
    </Suspense>
  );
}
