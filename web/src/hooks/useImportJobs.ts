"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import type { ImportJobState, ImportJobStatus } from "@/types";

export const IMPORT_JOBS_KEY = ["import-jobs"] as const;
/** How often the job list refreshes while an import is still working. */
export const IMPORT_POLL_MS = 1500;

export function isActiveImport(job: Pick<ImportJobStatus, "status">): boolean {
  return job.status === "queued" || job.status === "running";
}

/** The account's Spotify imports, newest first; polls while one is working. */
export function useImportJobs() {
  return useQuery({
    queryKey: IMPORT_JOBS_KEY,
    queryFn: api.importJobs,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.some(isActiveImport) ? IMPORT_POLL_MS : false,
  });
}

/** Full result of a finished import; only fetched once the job is done. */
export function useImportJobResult(job: ImportJobStatus | undefined) {
  return useQuery({
    queryKey: ["import-job", job?.id],
    queryFn: async () => {
      if (!job) throw new Error("Kein Import ausgewählt.");
      const detail = await api.importJob(job.id);
      if (detail.status !== "done" || !detail.result) {
        throw new Error(
          `Import ${detail.id} hat kein Ergebnis (Status: ${detail.status}).`,
        );
      }
      return detail;
    },
    enabled: job?.status === "done",
    // A finished import never changes again.
    staleTime: Infinity,
  });
}

/** One-line state of an import for lists and notifications. */
export function importJobSummary(job: ImportJobStatus): string {
  switch (job.status) {
    case "queued":
      return "Wartet auf Start…";
    case "running":
      return job.total === 0
        ? "Liest die Titel von Spotify…"
        : `${job.processed}/${job.total} abgeglichen · ${job.matched} gefunden`;
    case "done":
      return `Fertig · ${job.matched}/${job.total} Titel gefunden`;
    case "failed":
      return `Fehlgeschlagen: ${job.error ?? "ohne Fehlermeldung vom Server"}`;
  }
}

export function importJobTitle(job: ImportJobStatus): string {
  return job.name || job.url;
}

/**
 * Announces imports that finish while the app is open, wherever the user is,
 * so a big playlist can run in the background. Mounted once in the shell.
 */
export function ImportJobWatcher() {
  const jobs = useImportJobs();
  const seen = useRef<Map<string, ImportJobState> | null>(null);

  useEffect(() => {
    if (!jobs.data) return;
    const previous = seen.current;
    const next = new Map(jobs.data.map((job) => [job.id, job.status] as const));
    seen.current = next;
    // The first list only establishes what was already there.
    if (previous === null) return;
    for (const job of jobs.data) {
      const before = previous.get(job.id);
      if (!before || !isActiveImport({ status: before }) || isActiveImport(job)) continue;
      if (job.status === "done") {
        toast.success(
          `Spotify-Import fertig: ${importJobTitle(job)} (${job.matched}/${job.total} Titel). Abholen unter Suche → Spotify-Import.`,
        );
      } else {
        toast.error(`Spotify-Import fehlgeschlagen: ${importJobTitle(job)}. ${job.error ?? ""}`.trim());
      }
    }
  }, [jobs.data]);

  const { isError, error, errorUpdatedAt } = jobs;
  useEffect(() => {
    if (isError) toast.error(`Spotify-Importe konnten nicht abgefragt werden: ${error.message}`);
  }, [isError, error, errorUpdatedAt]);

  return null;
}
