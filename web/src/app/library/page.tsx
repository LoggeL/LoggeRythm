"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMe } from "@/hooks/useAuth";
import { useLikes, usePlaylists } from "@/hooks/useLibrary";
import { useFollowing } from "@/hooks/useFollows";
import { useDownloads } from "@/hooks/useDownloads";
import { useLocalJson } from "@/hooks/useLocalJson";
import { api } from "@/lib/api";
import { playlistPath } from "@/lib/slugs";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import TrackRow from "@/components/TrackRow";
import ArtistCard from "@/components/ArtistCard";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import Modal from "@/components/Modal";
import { RowListSkeleton, CardGridSkeleton } from "@/components/Skeleton";
import {
  HeartIcon,
  DownloadIcon,
  PlayIcon,
  PlusIcon,
} from "@/components/icons";
import CreatePlaylistDialog from "./CreatePlaylistDialog";
import {
  libraryTabFromParam,
  libraryTabHref,
  type LibraryTab,
} from "./navigation";
import type { Track } from "@/types";

const EMPTY_TRACKS: Track[] = [];
const TABS: { key: LibraryTab; label: string }[] = [
  { key: "playlists", label: "Playlists" },
  { key: "liked", label: "Gelikte Titel" },
  { key: "following", label: "Künstler" },
  { key: "recent", label: "Verlauf" },
  { key: "downloads", label: "Downloads" },
];

function LibraryContent() {
  const searchParams = useSearchParams();
  const tab = libraryTabFromParam(searchParams.get("tab"));
  const tabHref = (next: LibraryTab) =>
    libraryTabHref(searchParams.toString(), next);
  const meQuery = useMe();
  const { data: me } = meQuery;
  const likesQuery = useLikes(!!me && tab === "liked");
  const playlistsQuery = usePlaylists(!!me && tab === "playlists");
  const followingQuery = useFollowing(!!me && tab === "following");
  const { downloads, removeDownload, clearAllDownloads, supported } =
    useDownloads();
  const playQueue = usePlayerStore((state) => state.playQueue);
  const [recent] = useLocalJson<Track[]>("sf_recent_tracks", EMPTY_TRACKS);
  if (!Array.isArray(recent)) {
    throw new Error(
      'Ungültiger Hörverlauf in localStorage["sf_recent_tracks"]: erwartet wurde eine Titelliste.',
    );
  }
  const [creating, setCreating] = useState(false);
  const [removingDownload, setRemovingDownload] = useState<string | null>(null);
  const [confirmClearDownloads, setConfirmClearDownloads] = useState(false);
  const [clearDownloadsError, setClearDownloadsError] = useState<string | null>(
    null,
  );
  const removeRequest = useRef<string | null>(null);

  if (meQuery.isLoading)
    return (
      <div role="status" aria-label="Bibliothek wird geladen">
        <RowListSkeleton />
      </div>
    );
  if (meQuery.isError && !me)
    return <LibraryQueryError label="Deine Kontodaten" query={meQuery} />;
  if (!me) {
    return (
      <div className="flex flex-col gap-6">
        <header className="page-header">
          <div>
            <p className="page-eyebrow">Deine Sammlung</p>
            <h1 className="page-title">Bibliothek</h1>
            <p className="page-description">
              Deine Playlists, Lieblingsmusik und Künstler an einem Ort.
            </p>
          </div>
        </header>
        <div className="empty-panel">
          <p>Melde dich an, um deine gelikten Titel und Playlists zu sehen.</p>
          <Link href="/login" className="action-primary mt-4">
            Anmelden
          </Link>
        </div>
      </div>
    );
  }

  const tracks = likesQuery.data ?? EMPTY_TRACKS;
  const downloadEntries = Object.entries(downloads);

  async function handleRemoveDownload(id: string) {
    if (removeRequest.current !== null) return;
    removeRequest.current = id;
    setRemovingDownload(id);
    try {
      if (downloads[id].trackIds) {
        await removeDownload(id);
      } else {
        const playlist = await api.playlist(id);
        if (!Array.isArray(playlist.tracks))
          throw new Error(
            "Die Playlist-Antwort enthält keine gültige Titelliste.",
          );
        await removeDownload(id, playlist.tracks);
      }
      toast.info("Offline-Download entfernt.");
    } catch (error) {
      toast.error(
        `Download konnte nicht entfernt werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      removeRequest.current = null;
      setRemovingDownload(null);
    }
  }

  async function handleClearDownloads() {
    if (removeRequest.current !== null) return;
    removeRequest.current = "all";
    setRemovingDownload("all");
    setClearDownloadsError(null);
    try {
      await clearAllDownloads();
      setConfirmClearDownloads(false);
      toast.info("Alle Offline-Downloads auf diesem Gerät wurden gelöscht.");
    } catch (error) {
      setClearDownloadsError(
        `Offline-Downloads konnten nicht gelöscht werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      removeRequest.current = null;
      setRemovingDownload(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 md:gap-8 animate-in">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Deine Sammlung</p>
          <h1 className="page-title">Bibliothek</h1>
          <p className="page-description">
            Deine Playlists, Lieblingsmusik und Künstler an einem Ort.
          </p>
        </div>
        <button
          type="button"
          className="action-primary"
          onClick={() => setCreating(true)}
        >
          <PlusIcon width={18} height={18} />
          Playlist erstellen
        </button>
      </header>
      {meQuery.isError && (
        <LibraryQueryError label="Deine Kontodaten" query={meQuery} />
      )}

      <div className="surface-card flex flex-wrap items-center gap-x-7 gap-y-3 px-5 py-4 text-sm">
        <Link
          href={tabHref("recent")}
          scroll={false}
          className="text-muted hover:text-foreground"
        >
          <span className="font-medium text-foreground tabular-nums">
            {recent.length}
          </span>{" "}
          Titel im Verlauf
        </Link>
        <Link
          href={tabHref("downloads")}
          scroll={false}
          className="text-muted hover:text-foreground"
        >
          <span className="font-medium text-foreground tabular-nums">
            {downloadEntries.length}
          </span>{" "}
          Offline-Playlists
        </Link>
        <Link
          href={tabHref("liked")}
          scroll={false}
          className="inline-flex items-center gap-2 text-muted hover:text-foreground"
        >
          <HeartIcon width={16} height={16} />
          {likesQuery.isSuccess
            ? `${tracks.length} gelikte Titel`
            : "Deine Lieblingstitel"}
        </Link>
      </div>

      <nav
        aria-label="Bibliotheksbereiche"
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={tabHref(item.key)}
            scroll={false}
            aria-current={tab === item.key ? "page" : undefined}
            data-active={tab === item.key}
            className="filter-chip flex-shrink-0"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "playlists" && (
        <section aria-labelledby="playlist-heading">
          <div className="section-heading flex-wrap">
            <h2 id="playlist-heading">Deine Playlists</h2>
            {playlistsQuery.isSuccess && (
              <span className="text-sm text-muted">
                {playlistsQuery.data.length} Playlists
              </span>
            )}
          </div>
          {playlistsQuery.isLoading && <CardGridSkeleton count={5} />}
          {playlistsQuery.isError && (
            <LibraryQueryError label="Deine Playlists" query={playlistsQuery} />
          )}
          {playlistsQuery.isSuccess && playlistsQuery.data.length === 0 && (
            <div className="empty-panel mb-5">
              <p>Hier ist Platz für deine erste Playlist.</p>
              <button
                type="button"
                className="action-secondary mt-4"
                onClick={() => setCreating(true)}
              >
                Playlist erstellen
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            <Link
              href={tabHref("liked")}
              scroll={false}
              className="music-card p-3"
            >
              <div className="aspect-square rounded-lg bg-accent/15 flex items-center justify-center mb-3">
                <HeartIcon
                  filled
                  width={42}
                  height={42}
                  className="text-accent-soft"
                />
              </div>
              <div className="font-medium">Gelikte Titel</div>
              <div className="text-sm text-muted mt-1">
                Deine Lieblingstitel
              </div>
            </Link>
            {(playlistsQuery.data ?? []).map((playlist) => (
              <Link
                key={String(playlist.id)}
                href={playlistPath(playlist)}
                className="music-card p-3"
              >
                {playlist.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={playlist.cover_url}
                    alt=""
                    className="w-full aspect-square object-cover rounded-lg mb-3"
                    loading="lazy"
                  />
                ) : (
                  <CoverPlaceholder className="w-full aspect-square rounded-lg mb-3" />
                )}
                <div className="truncate font-medium">{playlist.name}</div>
                <div className="truncate text-sm text-muted mt-1">
                  {playlist.track_count} Titel
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {tab === "liked" && (
        <section aria-labelledby="liked-heading">
          <div className="section-heading">
            <div>
              <h2 id="liked-heading">Gelikte Titel</h2>
              {likesQuery.isSuccess && (
                <p className="text-sm text-muted mt-1">{tracks.length} Titel</p>
              )}
            </div>
            {tracks.length > 0 && (
              <button
                type="button"
                className="action-primary"
                onClick={() => playQueue(tracks, 0, "Gelikte Titel")}
              >
                <PlayIcon width={18} height={18} />
                Abspielen
              </button>
            )}
          </div>
          {likesQuery.isLoading && <RowListSkeleton />}
          {likesQuery.isError && (
            <LibraryQueryError
              label="Deine gelikten Titel"
              query={likesQuery}
            />
          )}
          {likesQuery.isSuccess && tracks.length === 0 && (
            <div className="empty-panel">
              <p>Du hast noch keine Titel geliked.</p>
              <Link href="/search" className="action-secondary mt-4">
                Lieblingsmusik suchen
              </Link>
            </div>
          )}
          <div className="flex flex-col">
            {tracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                onPlay={() => playQueue(tracks, index, "Gelikte Titel")}
              />
            ))}
          </div>
        </section>
      )}

      {tab === "recent" && (
        <section aria-labelledby="recent-heading">
          <div className="section-heading">
            <div>
              <h2 id="recent-heading">Zuletzt gehört</h2>
              <p className="text-sm text-muted mt-1">
                {recent.length} Titel auf diesem Gerät
              </p>
            </div>
            {recent.length > 0 && (
              <button
                type="button"
                className="action-primary"
                onClick={() => playQueue(recent, 0, "Zuletzt gehört")}
              >
                <PlayIcon width={18} height={18} />
                Abspielen
              </button>
            )}
          </div>
          {recent.length === 0 ? (
            <div className="empty-panel">
              <p>Hier erscheinen die Titel, die du auf diesem Gerät hörst.</p>
              <Link href="/genre" className="action-secondary mt-4">
                Musik entdecken
              </Link>
            </div>
          ) : (
            <div className="flex flex-col">
              {recent.map((track, index) => (
                <TrackRow
                  key={`${track.id}-${index}`}
                  track={track}
                  index={index}
                  onPlay={() => playQueue(recent, index, "Zuletzt gehört")}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "downloads" && (
        <section aria-labelledby="download-heading">
          <div className="section-heading flex-wrap">
            <div>
              <h2 id="download-heading">Offline hören</h2>
              <p className="text-sm text-muted mt-1">
                Auf diesem Gerät gespeicherte Playlists.
              </p>
            </div>
            {supported && downloadEntries.length > 0 && (
              <button
                type="button"
                className="action-secondary"
                disabled={removingDownload !== null}
                onClick={() => {
                  setClearDownloadsError(null);
                  setConfirmClearDownloads(true);
                }}
              >
                Alle Offline-Downloads löschen
              </button>
            )}
          </div>
          {!supported && (
            <div className="empty-panel">
              Offline-Downloads werden von diesem Browser nicht unterstützt.
            </div>
          )}
          {supported && downloadEntries.length === 0 && (
            <div className="empty-panel">
              <p>
                Noch keine Downloads. Öffne eine Playlist und wähle
                &quot;Herunterladen&quot;, um sie offline verfügbar zu machen.
              </p>
              <Link
                href={tabHref("playlists")}
                className="action-secondary mt-4"
              >
                Deine Playlists öffnen
              </Link>
            </div>
          )}
          {supported && downloadEntries.length > 0 && (
            <ul className="flex flex-col gap-3">
              {downloadEntries.map(([id, info]) => (
                <li
                  key={id}
                  className="surface-card flex items-center gap-3 px-4 py-4"
                >
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-soft">
                    <DownloadIcon width={20} height={20} />
                  </span>
                  <Link
                    href={`/playlist/${encodeURIComponent(id)}`}
                    className="min-w-0 flex-1 hover:underline"
                  >
                    <span className="block truncate font-medium">
                      {info.name}
                    </span>
                    <span className="block text-sm text-muted mt-1">
                      {info.total} Titel offline
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void handleRemoveDownload(id)}
                    disabled={removingDownload !== null}
                    className="action-secondary flex-shrink-0"
                  >
                    {removingDownload === id ? "Entfernt…" : "Entfernen"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "following" && (
        <section aria-labelledby="following-heading">
          <div className="section-heading">
            <div>
              <h2 id="following-heading">Deine Künstler</h2>
              <p className="text-sm text-muted mt-1">
                Ihre neuen Titel findest du im Release Radar.
              </p>
            </div>
            <Link href="/radar" className="action-secondary">
              Release Radar
            </Link>
          </div>
          {followingQuery.isLoading && <CardGridSkeleton count={6} />}
          {followingQuery.isError && (
            <LibraryQueryError
              label="Deine gefolgten Künstler"
              query={followingQuery}
            />
          )}
          {followingQuery.isSuccess && followingQuery.data.length === 0 && (
            <div className="empty-panel">
              <p>Du folgst noch keinen Künstlern.</p>
              <Link href="/search" className="action-secondary mt-4">
                Künstler suchen
              </Link>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {(followingQuery.data ?? []).map((artist) => (
              <ArtistCard key={String(artist.id)} artist={artist} />
            ))}
          </div>
        </section>
      )}
      <CreatePlaylistDialog
        open={creating}
        onClose={() => setCreating(false)}
      />
      <Modal
        open={confirmClearDownloads}
        title="Alle Offline-Downloads löschen"
        onClose={() => {
          if (removingDownload !== "all") setConfirmClearDownloads(false);
        }}
      >
        <p className="text-sm text-muted">
          Die gespeicherte Musik dieser Playlists wird auf diesem Gerät
          gelöscht. Deine Playlists bleiben in deiner Bibliothek erhalten und
          können erneut heruntergeladen werden.
        </p>
        <ul className="mt-4 max-h-48 overflow-y-auto space-y-2 text-sm">
          {downloadEntries.map(([id, info]) => (
            <li key={id} className="truncate">
              {info.name}{" "}
              <span className="text-muted">({info.total} Titel)</span>
            </li>
          ))}
        </ul>
        {clearDownloadsError && (
          <p role="alert" className="error-panel mt-4">
            {clearDownloadsError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="action-secondary"
            disabled={removingDownload === "all"}
            onClick={() => setConfirmClearDownloads(false)}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="action-primary"
            disabled={removingDownload === "all"}
            onClick={() => void handleClearDownloads()}
          >
            {removingDownload === "all"
              ? "Wird gelöscht…"
              : "Offline-Downloads löschen"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

type RetryableQuery = {
  error: Error | null;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

function LibraryQueryError({
  label,
  query,
}: {
  label: string;
  query: RetryableQuery;
}) {
  return (
    <div role="alert" className="error-panel mb-4">
      <p>
        {label} konnten nicht geladen werden: {query.error?.message}
      </p>
      <button
        type="button"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
        className="action-secondary mt-3"
      >
        {query.isFetching ? "Wird geladen…" : "Erneut versuchen"}
      </button>
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Bibliothek wird geladen">
          <RowListSkeleton />
        </div>
      }
    >
      <LibraryContent />
    </Suspense>
  );
}
