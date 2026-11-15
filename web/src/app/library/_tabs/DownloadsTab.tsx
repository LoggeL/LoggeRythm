"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import EmptyState from "@/components/ui/EmptyState";
import { DownloadIcon, DownloadedIcon } from "@/components/icons";
import { useDownloads } from "@/hooks/useDownloads";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import TabHeader from "./TabHeader";

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Playlists stored for offline listening on this device. */
export default function DownloadsTab({ playlistsHref }: { playlistsHref: string }) {
  const { downloads, removeDownload, clearAllDownloads, supported } = useDownloads();
  // "all" while the whole-device cleanup runs, otherwise the playlist id.
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  // Reserves the operation before React rerenders, so double clicks cannot race.
  const removeRequest = useRef<string | null>(null);
  const entries = Object.entries(downloads);

  async function handleRemove(id: string) {
    if (removeRequest.current !== null) return;
    removeRequest.current = id;
    setRemoving(id);
    try {
      if (downloads[id].trackIds) {
        await removeDownload(id);
      } else {
        // Downloads saved before track ids were recorded need the playlist's titles.
        const playlist = await api.playlist(id);
        if (!Array.isArray(playlist.tracks)) throw new Error("Die Playlist-Antwort enthält keine gültige Titelliste.");
        await removeDownload(id, playlist.tracks);
      }
      toast.info("Offline-Download entfernt.");
    } catch (error) {
      toast.error(`Download konnte nicht entfernt werden: ${detail(error)}`);
    } finally {
      removeRequest.current = null;
      setRemoving(null);
    }
  }

  async function handleClear() {
    if (removeRequest.current !== null) return;
    removeRequest.current = "all";
    setRemoving("all");
    setClearError(null);
    try {
      await clearAllDownloads();
      setConfirmClear(false);
      toast.info("Alle Offline-Downloads auf diesem Gerät wurden gelöscht.");
    } catch (error) {
      setClearError(`Offline-Downloads konnten nicht gelöscht werden: ${detail(error)}`);
    } finally {
      removeRequest.current = null;
      setRemoving(null);
    }
  }

  return (
    <section aria-labelledby="download-heading">
      <TabHeader id="download-heading" title="Offline hören" meta="Auf diesem Gerät gespeicherte Playlists.">
        {supported && entries.length > 0 && (
          <button
            type="button"
            className="action-secondary"
            disabled={removing !== null}
            onClick={() => {
              setClearError(null);
              setConfirmClear(true);
            }}
          >
            Alle Offline-Downloads löschen
          </button>
        )}
      </TabHeader>

      {!supported ? (
        <EmptyState icon={<DownloadIcon width={24} height={24} />} title="Offline-Downloads sind hier nicht verfügbar">
          Dieser Browser unterstützt keinen Offline-Speicher. In einem aktuellen Browser oder der installierten App kannst du Playlists herunterladen.
        </EmptyState>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<DownloadIcon width={24} height={24} />}
          title="Noch keine Downloads"
          action={
            <Link href={playlistsHref} scroll={false} className="action-secondary">
              Deine Playlists öffnen
            </Link>
          }
        >
          Öffne eine Playlist und wähle „Herunterladen“, um sie offline verfügbar zu machen.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {entries.map(([id, info]) => (
            <li key={id} className="flex items-center gap-3 py-3">
              <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-success">
                <DownloadedIcon width={20} height={20} />
              </span>
              <Link href={`/playlist/${encodeURIComponent(id)}`} className="group min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold group-hover:underline">{info.name}</span>
                <span className="mt-0.5 block text-xs text-muted">{info.total} Titel offline</span>
              </Link>
              <button
                type="button"
                onClick={() => void handleRemove(id)}
                disabled={removing !== null}
                aria-label={`Download entfernen: ${info.name}`}
                className="action-secondary shrink-0 px-4 text-xs sm:min-h-9"
              >
                {removing === id ? "Entfernt…" : "Entfernen"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={confirmClear}
        title="Alle Offline-Downloads löschen"
        description="Die gespeicherte Musik dieser Playlists wird auf diesem Gerät gelöscht. Deine Playlists bleiben in deiner Bibliothek erhalten und können erneut heruntergeladen werden."
        onClose={() => {
          if (removing !== "all") setConfirmClear(false);
        }}
        footer={
          <>
            <button type="button" data-dialog-autofocus className="action-secondary" disabled={removing === "all"} onClick={() => setConfirmClear(false)}>
              Abbrechen
            </button>
            <button type="button" className="action-secondary action-danger" disabled={removing === "all"} onClick={() => void handleClear()}>
              {removing === "all" ? "Wird gelöscht…" : "Offline-Downloads löschen"}
            </button>
          </>
        }
      >
        <ul className="flex flex-col gap-2 text-sm">
          {entries.map(([id, info]) => (
            <li key={id} className="truncate">
              {info.name} <span className="text-muted">({info.total} Titel)</span>
            </li>
          ))}
        </ul>
        {clearError && (
          <p role="alert" className="error-panel mt-4">
            {clearError}
          </p>
        )}
      </Modal>
    </section>
  );
}
