"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMe } from "@/hooks/useAuth";
import { useLikes, usePlaylists } from "@/hooks/useLibrary";
import { useFollowing } from "@/hooks/useFollows";
import { useDownloads } from "@/hooks/useDownloads";
import { api } from "@/lib/api";
import { playlistPath } from "@/lib/slugs";
import { usePlayerStore, getRecentTracks } from "@/store/player";
import { toast } from "@/store/toast";
import TrackRow from "@/components/TrackRow";
import ArtistCard from "@/components/ArtistCard";
import { RowListSkeleton } from "@/components/Skeleton";
import { HeartIcon, DownloadIcon } from "@/components/icons";
import { libraryTabFromParam, libraryTabHref, type LibraryTab } from "./navigation";

function LibraryContent() {
  const meQuery = useMe();
  const { data: me, isLoading: meLoading } = meQuery;
  const likesQuery = useLikes(!!me);
  const { data: likes, isLoading: likesLoading } = likesQuery;
  const playlistsQuery = usePlaylists(!!me);
  const { data: playlists } = playlistsQuery;
  const followingQuery = useFollowing(!!me);
  const { data: following } = followingQuery;
  const { downloads, removeDownload, supported } = useDownloads();
  const playQueue = usePlayerStore((s) => s.playQueue);

  const searchParams = useSearchParams();
  const tab = libraryTabFromParam(searchParams.get("tab"));
  const tabHref = (next: LibraryTab) => libraryTabHref(searchParams.toString(), next);
  // Read once per mount — recently played only changes through playback.
  const [recent] = useState(() => getRecentTracks());
  const [removingDownload, setRemovingDownload] = useState<string | null>(null);

  if (meLoading) return <RowListSkeleton />;

  if (meQuery.isError && !me) {
    return <LibraryQueryError label="Deine Kontodaten" query={meQuery} />;
  }

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
  const downloadEntries = Object.entries(downloads);
  const TABS: { key: LibraryTab; label: string }[] = [
    { key: "playlists", label: "Playlists" },
    { key: "liked", label: "Gelikte Titel" },
    { key: "recent", label: "Zuletzt gehört" },
    { key: "downloads", label: "Downloads" },
    { key: "following", label: "Gefolgt" },
  ];

  async function handleRemoveDownload(id: string) {
    setRemovingDownload(id);
    try {
      const pl = await api.playlist(id);
      await removeDownload(id, pl.tracks ?? []);
      toast.info("Offline-Download entfernt.");
    } catch (err) {
      toast.error(
        `Download konnte nicht entfernt werden — ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setRemovingDownload(null);
    }
  }

  return (
    <div className="animate-in">
      <h1 className="text-3xl font-extrabold mb-4">Deine Bibliothek</h1>
      {meQuery.isError && <LibraryQueryError label="Deine Kontodaten" query={meQuery} />}

      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            scroll={false}
            aria-current={tab === t.key ? "page" : undefined}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              tab === t.key
                ? "bg-foreground text-background"
                : "bg-panel text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "playlists" && (
        <>
        {playlistsQuery.isLoading && <RowListSkeleton />}
        {playlistsQuery.isError && <LibraryQueryError label="Deine Playlists" query={playlistsQuery} />}
        {likesQuery.isError && <LibraryQueryError label="Deine gelikten Titel" query={likesQuery} />}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <Link
            href={tabHref("liked")}
            scroll={false}
            className="hover-lift text-left bg-accent rounded-lg p-4 transition"
          >
            <div className="w-full aspect-square rounded-md bg-white/10 flex items-center justify-center mb-3">
              <HeartIcon filled width={40} height={40} className="text-white" />
            </div>
            <div className="font-semibold">Gelikte Titel</div>
            <div className="text-sm text-white/70">
              {likesQuery.isError ? "Laden fehlgeschlagen" : likesQuery.isSuccess ? `${tracks.length} Titel` : "Wird geladen…"}
            </div>
          </Link>

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
        </>
      )}

      {tab === "liked" && (
        <>
          <p className="text-muted mb-4">Gelikte Titel{likesQuery.isSuccess ? ` · ${tracks.length}` : ""}</p>
          {likesLoading && <RowListSkeleton />}
          {likesQuery.isError && <LibraryQueryError label="Deine gelikten Titel" query={likesQuery} />}
          {likesQuery.isSuccess && tracks.length === 0 && (
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

      {tab === "recent" && (
        <>
          <p className="text-muted mb-4">Zuletzt gehört · {recent.length}</p>
          {recent.length === 0 ? (
            <p className="text-muted">
              Noch nichts gehört — spiele ein paar Titel, dann tauchen sie hier
              auf.
            </p>
          ) : (
            <div className="flex flex-col">
              {recent.map((track, i) => (
                <TrackRow
                  key={`${track.id}-${i}`}
                  track={track}
                  index={i}
                  onPlay={() => playQueue(recent, i, "Zuletzt gehört")}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "downloads" && (
        <>
          {!supported && (
            <p className="text-muted">
              Offline-Downloads werden von diesem Browser nicht unterstützt.
            </p>
          )}
          {supported && downloadEntries.length === 0 && (
            <p className="text-muted">
              Noch keine Downloads. Öffne eine Playlist und tippe auf
              „Herunterladen“, um sie offline verfügbar zu machen.
            </p>
          )}
          {supported && downloadEntries.length > 0 && (
            <ul className="flex flex-col gap-2">
              {downloadEntries.map(([id, info]) => {
                const summary = (playlists ?? []).find(
                  (p) => String(p.id) === id,
                );
                return (
                  <li
                    key={id}
                    className="flex items-center gap-3 bg-panel rounded-lg px-4 py-3"
                  >
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-panel-hover text-accent">
                      <DownloadIcon width={20} height={20} />
                    </span>
                    <Link
                      href={summary ? playlistPath(summary) : `/playlist/${id}`}
                      className="min-w-0 flex-1 hover:underline"
                    >
                      <span className="block truncate font-semibold">
                        {info.name}
                      </span>
                      <span className="block text-sm text-muted">
                        {info.total} Titel offline
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRemoveDownload(id)}
                      disabled={removingDownload === id}
                      className="press flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium bg-panel-hover hover:bg-white/10 disabled:opacity-50"
                    >
                      {removingDownload === id ? "Entfernt…" : "Entfernen"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {tab === "following" && (
        <>
          {followingQuery.isLoading && <RowListSkeleton />}
          {followingQuery.isError && <LibraryQueryError label="Deine gefolgten Künstler" query={followingQuery} />}
          {followingQuery.isSuccess && followingQuery.data.length === 0 && (
            <p className="text-muted">Du folgst noch keinen Künstlern.</p>
          )}
          {following && following.length > 0 && (
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

type RetryableQuery = {
  error: Error | null;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

function LibraryQueryError({ label, query }: { label: string; query: RetryableQuery }) {
  return (
    <div role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
      {label} konnten nicht geladen werden: {query.error?.message}
      <button
        type="button"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
        className="ml-3 underline disabled:opacity-50"
      >
        {query.isFetching ? "Wird geladen…" : "Erneut versuchen"}
      </button>
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense>
      <LibraryContent />
    </Suspense>
  );
}
