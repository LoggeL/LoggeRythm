"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { StorageInfo } from "@/types";
import {
  errorMessage,
  formatBytes,
  formatCount,
  Metric,
  SectionError,
  SettingsCard,
} from "@/app/account/presentation";
import { HeartIcon } from "@/components/icons";
import type { LikesDeduplicationResult } from "@/types";
import { DiskIcon } from "./statusIcons";

/** "Speicher" admin section: cache metrics, disk utilization and manual cleanup. */
export default function StorageSection() {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = useQuery<StorageInfo>({
    queryKey: ["admin-storage"],
    queryFn: api.adminStorage,
  });
  const cleanup = useMutation({
    mutationFn: api.adminStorageCleanup,
    onSuccess: (result) => {
      toast.success(
        result.removed
          ? `${result.removed} Titel entfernt (${formatBytes(result.freed_bytes)} frei).`
          : "Nichts zu entfernen.",
      );
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ["admin-storage"] });
      qc.invalidateQueries({ queryKey: ["admin-usage"] });
    },
    onError: (err) => toast.error(`Aufräumen fehlgeschlagen: ${errorMessage(err)}`),
  });
  const usedPct = data && data.disk_total > 0 ? (data.disk_used / data.disk_total) * 100 : null;

  return (
    <SettingsCard
      title="Speicher"
      description={
        data
          ? data.retention_days > 0
            ? `Titel, die ${data.retention_days} Tage nicht gespielt wurden, werden automatisch gelöscht. Gelikte Titel und Titel in Playlists bleiben erhalten.`
            : "Es ist keine automatische Löschung eingerichtet."
          : "Belegung des Titel-Caches auf dem Server."
      }
      icon={<DiskIcon width={18} height={18} />}
      action={
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={cleanup.isPending || !data}
          className="action-secondary"
        >
          Jetzt aufräumen
        </button>
      }
    >
      <ConfirmDialog
        open={confirming}
        title="Speicher jetzt aufräumen?"
        confirmLabel="Aufräumen"
        destructive
        busy={cleanup.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => cleanup.mutate()}
      >
        Lange nicht gespielte Titel werden vom Server gelöscht. Sie werden beim nächsten Abspielen erneut geladen.
      </ConfirmDialog>

      {isLoading && (
        <div role="status" aria-label="Speicher wird geladen" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <span key={index} className="skeleton block h-12 rounded-lg" />
          ))}
        </div>
      )}
      {error && (
        <SectionError
          label="Die Speicherdaten"
          error={error}
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      )}
      {data && (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric value={formatCount(data.track_count)} label="Titel" />
            <Metric value={formatBytes(data.total_bytes)} label="Belegt durch Titel" />
            <Metric value={formatBytes(data.disk_free)} label="Frei" />
            <Metric value={formatBytes(data.disk_total)} label="Gesamt" />
          </dl>
          {usedPct !== null && (
            <div className="mt-5">
              <div
                role="progressbar"
                aria-label="Speicherauslastung"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(usedPct)}
                className="h-1.5 overflow-hidden rounded-full bg-white/10"
              >
                <div
                  className={`h-full rounded-full ${usedPct >= 90 ? "bg-danger" : "bg-accent"}`}
                  style={{ width: `${Math.min(100, usedPct)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                {formatBytes(data.disk_used)} von {formatBytes(data.disk_total)} belegt ·{" "}
                {formatBytes(data.disk_free)} frei
              </p>
            </div>
          )}
        </>
      )}
    </SettingsCard>
  );
}

export function LikesDeduplicationSection() {
  const qc = useQueryClient();
  const [lastResult, setLastResult] = useState<LikesDeduplicationResult | null>(null);
  const run = useMutation({
    mutationFn: api.adminDeduplicateLikes,
    onSuccess: (result) => {
      setLastResult(result);
      qc.invalidateQueries({ queryKey: ["likes"] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      if (result.errors.length > 0) {
        toast.error(
          `Zusammenführung mit ${result.errors.length} Fehler(n) abgeschlossen (${result.likes_removed} Duplikate entfernt).`,
        );
      } else if (result.likes_removed > 0) {
        toast.success(
          `${result.likes_removed} doppelte Likes in ${result.duplicate_groups_merged} Song-Gruppe(n) zusammengeführt.`,
        );
      } else {
        toast.success("Keine doppelten Likes gefunden.");
      }
    },
    onError: (err) => toast.error(`Zusammenführen fehlgeschlagen: ${errorMessage(err)}`),
  });

  return (
    <SettingsCard
      title="Song-Duplikate zusammenführen"
      description="Doppelte Likes per ISRC – bevorzugt Album vor EP vor Single. Ergänzt fehlende ISRCs."
      icon={<HeartIcon width={18} height={18} />}
      action={
        <button type="button" onClick={() => run.mutate()} disabled={run.isPending} className="action-secondary">
          {run.isPending ? "Wird geprüft…" : "Jetzt zusammenführen"}
        </button>
      }
    >
      {lastResult && (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric value={formatCount(lastResult.likes_scanned)} label="Likes geprüft" />
          <Metric value={formatCount(lastResult.likes_removed)} label="Duplikate entfernt" />
          <Metric value={formatCount(lastResult.isrc_backfilled)} label="Like-ISRCs ergänzt" />
          <Metric value={formatCount(lastResult.playlist_tracks_backfilled)} label="Playlist-ISRCs" />
        </dl>
      )}
      {lastResult && lastResult.errors.length > 0 && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {lastResult.errors.length} Fehler bei Deezer-Abfragen (erster Fehler: {lastResult.errors[0]})
        </p>
      )}
    </SettingsCard>
  );
}

/** "Verwaltung" tab (admins only): usage dashboard, system status, users, storage and invites. */
