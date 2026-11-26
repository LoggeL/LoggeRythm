"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import { DownloadIcon, DownloadedIcon, SpinnerIcon, UserIcon } from "@/components/icons";
import CollectionHero from "@/app/playlist/_components/CollectionHero";
import CollectionPageState from "@/app/playlist/_components/CollectionPageState";
import CollectionTracks from "@/app/playlist/_components/CollectionTracks";
import { CollectionMenu, PlayCollectionButton, ShuffleCollectionButton, useQueueAllItem, useSaveAsPlaylistItem } from "@/app/playlist/_components/CollectionActions";
import { usePlaylistOffline } from "@/app/playlist/_components/usePlaylistOffline";
import { tracksSummary } from "@/app/playlist/_components/collectionMeta";
import type { Album } from "@/types";

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const album = useQuery<Album>({
    queryKey: ["album", id],
    queryFn: () => api.album(id),
    enabled: !!id,
  });

  return (
    <CollectionPageState query={album} label="Die Albumdaten" missing="Album nicht gefunden">
      {(data) => <AlbumView album={data} />}
    </CollectionPageState>
  );
}

const releaseDateFormatter = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "12. März 2021" for a full ISO date; anything else is shown as delivered. */
function releaseDateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return value;
  return releaseDateFormatter.format(date);
}

function AlbumView({ album }: { album: Album }) {
  const router = useRouter();
  const playQueue = usePlayerStore((state) => state.playQueue);
  const tracks = album.tracks ?? [];
  const year = album.release_date ? album.release_date.slice(0, 4) : "";
  const offline = usePlaylistOffline(`album:${album.id}`, album.title, tracks, {
    kind: "album",
    cover: album.cover,
  });
  const queueAll = useQueueAllItem(tracks);
  const savePlaylist = useSaveAsPlaylistItem(album.title, tracks, `Album von ${album.artist}`);
  const menu = [queueAll, savePlaylist];
  if (album.artist_id) {
    menu.push({ label: "Zum Künstler", icon: <UserIcon width={18} height={18} />, separated: true, onClick: () => router.push(`/artist/${album.artist_id}`) });
  }
  const offlineLabel =
    offline.pending === "remove"
      ? "Offline-Download wird entfernt…"
      : offline.pending === "download"
        ? "Wird heruntergeladen…"
        : offline.downloaded
          ? "Offline-Download entfernen"
          : "Album offline verfügbar machen";

  return (
    <>
      <CollectionHero
        eyebrow="Album"
        title={album.title}
        coverUrl={album.cover}
        artwork={<Cover src={album.cover} alt={`Cover von ${album.title}`} eager />}
        metadata={
          <>
            {album.artist_id ? <Link href={`/artist/${album.artist_id}`}>{album.artist}</Link> : <strong>{album.artist}</strong>}
            {" · "}
            {[year, tracksSummary(tracks)].filter(Boolean).join(" · ")}
          </>
        }
        actions={
          <>
            <PlayCollectionButton tracks={tracks} context={album.title} />
            <ShuffleCollectionButton tracks={tracks} context={album.title} />
            {offline.supported && tracks.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => void offline.toggle()}
                  disabled={offline.pending !== null}
                  aria-pressed={offline.downloaded}
                  aria-busy={offline.pending !== null}
                  aria-label={offlineLabel}
                  title={offlineLabel}
                  className="action-icon h-11 w-11"
                >
                  {offline.pending ? (
                    <SpinnerIcon width={22} height={22} className="animate-spin" />
                  ) : offline.downloaded ? (
                    <DownloadedIcon width={22} height={22} className="text-success" />
                  ) : (
                    <DownloadIcon width={24} height={24} />
                  )}
                </button>
                {offline.progress && (
                  <span role="status" className="text-sm tabular-nums text-muted">
                    {offline.progress.done}/{offline.progress.total} gespeichert
                  </span>
                )}
              </>
            )}
            <CollectionMenu label="Weitere Optionen für dieses Album" items={menu} />
          </>
        }
      />
      <CollectionTracks count={tracks.length} showAlbum={false}>
        {tracks.length === 0 ? (
          <EmptyState
            title="Dieses Album enthält keine Titel"
            action={
              album.artist_id && (
                <Link href={`/artist/${album.artist_id}`} className="action-secondary">
                  Mehr von {album.artist}
                </Link>
              )
            }
          />
        ) : (
          tracks.map((track, index) => (
            <TrackRow key={track.id} track={track} index={index} showAlbum={false} showCover={false} onPlay={() => playQueue(tracks, index, album.title)} />
          ))
        )}
      </CollectionTracks>
      {tracks.length > 0 && (album.release_date || album.artist_id) && (
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hairline pt-4">
          {album.release_date && (
            <p className="label-mono tabular-nums">
              Veröffentlicht <time dateTime={album.release_date} className="text-foreground">{releaseDateLabel(album.release_date)}</time>
            </p>
          )}
          {album.artist_id && (
            <Link href={`/artist/${album.artist_id}`} className="section-link ml-auto inline-flex min-h-11 items-center gap-1.5 whitespace-normal text-right">
              Mehr von {album.artist}
            </Link>
          )}
        </footer>
      )}
    </>
  );
}
