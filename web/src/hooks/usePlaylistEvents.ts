"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { playlistEventsUrl } from "@/lib/api";
import { toast } from "@/store/toast";
import type { PlaylistSseEvent } from "@/types";

export type PlaylistSseOutcome = "ignore" | "refresh" | "revoked" | "deleted";

const VALID_EVENTS = new Set<string>(["snapshot", "updated", "revoked", "deleted"]);

export function parsePlaylistSseEvent(raw: string): PlaylistSseEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `Ungültiges JSON im Playlist-Live-Update: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Playlist-Live-Update: Ein Objekt wurde erwartet.");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.event !== "string" || !VALID_EVENTS.has(obj.event)) {
    throw new Error(`Playlist-Live-Update: Unbekannter Event-Typ ${JSON.stringify(obj.event)}.`);
  }
  if (typeof obj.revision !== "number" || !Number.isInteger(obj.revision) || obj.revision < 0) {
    throw new Error(`Playlist-Live-Update: Ungültige Revision ${JSON.stringify(obj.revision)}.`);
  }
  if (typeof obj.playlist_id !== "number" || !Number.isInteger(obj.playlist_id)) {
    throw new Error(`Playlist-Live-Update: Ungültige playlist_id ${JSON.stringify(obj.playlist_id)}.`);
  }
  return {
    playlist_id: obj.playlist_id,
    revision: obj.revision,
    event: obj.event as PlaylistSseEvent["event"],
  };
}

export function classifyPlaylistSseEvent(
  event: PlaylistSseEvent,
  lastRevision: number | undefined,
): PlaylistSseOutcome {
  if (event.event === "deleted") return "deleted";
  if (event.event === "revoked") return "revoked";
  if (event.event === "updated" && event.revision !== lastRevision) return "refresh";
  // After an SSE reconnect, a newer snapshot revision catches missed edits.
  if (event.event === "snapshot" && lastRevision !== undefined && event.revision > lastRevision) {
    return "refresh";
  }
  return "ignore";
}

/**
 * Subscribes to `GET /api/playlists/{id}/events` SSE so collaborative playlist
 * edits (track add/remove/reorder, metadata, collaborators) appear live for
 * every viewer, reconnect snapshots catch missed revisions, and terminal
 * `revoked`/`deleted` frames close the stream cleanly.
 */
export function usePlaylistEvents(
  playlistId: string | null,
  enabled: boolean,
  currentRevision?: number,
) {
  const qc = useQueryClient();
  const lastRevisionRef = useRef<number | undefined>(currentRevision);

  useEffect(() => {
    lastRevisionRef.current = currentRevision;
  }, [currentRevision]);

  useEffect(() => {
    if (!enabled || !playlistId || typeof EventSource === "undefined") return;
    const es = new EventSource(playlistEventsUrl(playlistId), { withCredentials: true });
    let closedByTerminalEvent = false;

    es.onmessage = (event) => {
      let parsed: PlaylistSseEvent;
      try {
        parsed = parsePlaylistSseEvent(event.data);
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        console.error(`[playlist-sse] invalid frame for playlist ${playlistId}`, cause);
        toast.error(msg);
        return;
      }
      const outcome = classifyPlaylistSseEvent(parsed, lastRevisionRef.current);
      if (outcome === "deleted" || outcome === "revoked") {
        closedByTerminalEvent = true;
        es.close();
        void qc.invalidateQueries({ queryKey: ["playlist", playlistId] });
        void qc.invalidateQueries({ queryKey: ["playlists"] });
        toast.info(
          outcome === "deleted"
            ? "Diese Playlist wurde gelöscht."
            : "Dein Zugriff auf diese Playlist wurde beendet.",
        );
        return;
      }
      if (outcome === "refresh") {
        lastRevisionRef.current = parsed.revision;
        void qc.invalidateQueries({ queryKey: ["playlist", playlistId] });
        void qc.invalidateQueries({ queryKey: ["playlists"] });
      }
    };

    es.onerror = () => {
      if (closedByTerminalEvent) return;
      if (es.readyState === EventSource.CLOSED) {
        toast.error("Live-Verbindung für Playlist-Änderungen wurde beendet.");
      }
    };

    return () => {
      es.close();
    };
  }, [playlistId, enabled, qc]);
}
