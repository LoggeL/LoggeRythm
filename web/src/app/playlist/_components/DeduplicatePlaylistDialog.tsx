"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import Modal from "@/components/Modal";
import QueryError from "@/components/ui/QueryError";
import { CheckCircleIcon } from "@/components/feedbackIcons";
import type { PlaylistDuplicatesResponse } from "@/types";

/**
 * Preview & 1-click deduplication dialog backed by
 * `GET /api/playlists/{id}/duplicates` and `POST /api/playlists/{id}/deduplicate`.
 */
export default function DeduplicatePlaylistDialog({
  id,
  name,
  onClose,
}: {
  id: string;
  name: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const query = useQuery<PlaylistDuplicatesResponse>({
    queryKey: ["playlist-duplicates", id],
    queryFn: () => api.playlistDuplicates(id),
    staleTime: 0,
  });

  const runDedupe = useMutation({
    mutationFn: () => api.deduplicatePlaylist(id),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["playlist", id] });
      void qc.invalidateQueries({ queryKey: ["playlists"] });
      void qc.invalidateQueries({ queryKey: ["playlist-duplicates", id] });
      toast.success(
        res.removed_count === 1
          ? "1 Duplikat entfernt."
          : `${res.removed_count} Duplikate entfernt.`,
      );
      onClose();
    },
    onError: (cause) => {
      toast.error(
        `Duplikate konnten nicht entfernt werden: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    },
  });

  const data = query.data;
  const hasDuplicates = Boolean(data && data.total_duplicates > 0);

  return (
    <Modal
      open
      onClose={onClose}
      title="Duplikate bereinigen"
      description={`Prüft „${name}“ anhand von Titel-ID, ISRC und Metadaten.`}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={runDedupe.isPending} className="action-secondary">
            Schließen
          </button>
          {hasDuplicates && (
            <button
              type="button"
              onClick={() => runDedupe.mutate()}
              disabled={runDedupe.isPending}
              className="action-primary"
            >
              {runDedupe.isPending
                ? "Entfernt…"
                : `${data!.total_duplicates} ${data!.total_duplicates === 1 ? "Duplikat" : "Duplikate"} entfernen`}
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        {query.isLoading && (
          <div role="status" aria-label="Suche nach Duplikaten" className="flex flex-col gap-2.5">
            <span className="skeleton block h-11 rounded-lg" />
            <span className="skeleton block h-11 rounded-lg" />
          </div>
        )}
        {query.isError && <QueryError label="Duplikatsprüfung" query={query} />}
        {data && data.total_duplicates === 0 && (
          <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-hairline bg-white/[0.03] px-4 py-4 text-sm">
            <CheckCircleIcon width={20} height={20} className="shrink-0 text-success" />
            <p className="text-foreground">Keine doppelten Titel in dieser Playlist gefunden.</p>
          </div>
        )}
        {hasDuplicates && data && (
          <>
            <p className="text-sm text-muted">
              Jeweils der erste Eintrag bleibt erhalten. Folgende{" "}
              <strong className="font-semibold text-foreground">{data.total_duplicates}</strong> überzähligen Einträge werden entfernt:
            </p>
            <ul className="scroll-area flex max-h-64 flex-col divide-y divide-hairline overflow-y-auto rounded-[var(--radius-card)] border border-hairline bg-white/[0.02]">
              {data.groups.map((group) => (
                <li key={group.keep_entry_id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">{group.title}</p>
                    <p className="truncate text-xs text-muted">
                      {group.artist}
                      {group.isrc ? ` · ${group.isrc}` : ""}
                    </p>
                  </div>
                  <span className="label-mono shrink-0 rounded-full border border-danger/35 bg-danger/10 px-2.5 py-0.5 text-[10px] text-danger tabular-nums">
                    −{group.duplicate_entry_ids.length}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
