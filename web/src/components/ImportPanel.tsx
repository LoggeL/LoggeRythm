"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { playlistPath } from "@/lib/slugs";
import { usePlayerStore } from "@/store/player";
import { useCreatePlaylist } from "@/hooks/useLibrary";
import {
  IMPORT_JOBS_KEY,
  importJobSummary,
  importJobTitle,
  isActiveImport,
  useImportJobResult,
  useImportJobs,
} from "@/hooks/useImportJobs";
import { toast } from "@/store/toast";
import TrackRow from "@/components/TrackRow";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import QueryError from "@/components/ui/QueryError";
import { CloseIcon, PlayIcon, PlusIcon, TrashIcon } from "@/components/icons";
import type {
  ImportJobDetail,
  ImportJobStatus,
  PlaylistSummary,
  ResolveResult,
  Track,
} from "@/types";

const TYPE_LABEL: Record<string, string> = {
  playlist: "Playlist",
  album: "Album",
  track: "Titel",
};

/** Matched tracks rendered at first and added per "Mehr anzeigen". */
const TRACK_PAGE = 100;

type SaveOperations = {
  createPlaylist: (input: {
    name: string;
    description: string;
  }) => Promise<PlaylistSummary>;
  addTracks: (id: string, tracks: Track[]) => Promise<{ added: number }>;
};

function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function assertValidResult(result: ResolveResult) {
  if (
    !result ||
    typeof result.name !== "string" ||
    !result.name.trim() ||
    !Array.isArray(result.tracks) ||
    !Array.isArray(result.unmatched)
  ) {
    throw new Error(
      "Die API-Antwort enthält keinen gültigen Namen oder keine gültige Titelliste.",
    );
  }
}

/**
 * Saves finished imports as playlists. Remembers the playlist created for
 * each import, so a retry after a failed bulk add fills that playlist instead
 * of creating a second one.
 */
export function createImportSaver(operations: SaveOperations) {
  let saving = false;
  const createdPlaylists = new Map<string, PlaylistSummary>();

  return {
    get isSaving() {
      return saving;
    },
    createdPlaylist(importId: string) {
      return createdPlaylists.get(importId);
    },
    async save(importId: string, result: ResolveResult) {
      if (saving) throw new Error("Die Playlist wird bereits gespeichert.");
      assertValidResult(result);
      if (result.tracks.length === 0)
        throw new Error("Es sind keine Deezer-Titel zum Speichern verfügbar.");
      saving = true;
      try {
        let playlist = createdPlaylists.get(importId);
        if (!playlist) {
          try {
            playlist = await operations.createPlaylist({
              name: result.name,
              description: "Von Spotify importiert",
            });
            if (
              !playlist ||
              playlist.id === undefined ||
              playlist.id === null ||
              String(playlist.id).trim() === ""
            ) {
              throw new Error("Die API-Antwort enthält keine Playlist-ID.");
            }
            createdPlaylists.set(importId, playlist);
          } catch (error) {
            throw new Error(
              `Playlist konnte nicht erstellt werden: ${errorDetail(error)}`,
              { cause: error },
            );
          }
        }
        try {
          const added = await operations.addTracks(
            String(playlist.id),
            result.tracks,
          );
          if (!added || !Number.isInteger(added.added) || added.added < 0) {
            throw new Error(
              "Die API-Antwort enthält keine gültige Anzahl gespeicherter Titel.",
            );
          }
          return { playlist, added: added.added };
        } catch (error) {
          throw new Error(
            `Titel konnten nicht in der Playlist gespeichert werden: ${errorDetail(error)}`,
            { cause: error },
          );
        }
      } finally {
        saving = false;
      }
    },
  };
}

type ImportSaver = ReturnType<typeof createImportSaver>;

function progressPercent(job: ImportJobStatus) {
  return job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
}

function ImportProgress({ job }: { job: ImportJobStatus }) {
  const percent = progressPercent(job);
  return (
    <div className="max-w-3xl">
      <div className="mb-5 flex items-end gap-4 sm:gap-6">
        {job.image ? (
          <Cover src={job.image} alt={job.name} className="cover-shadow h-24 w-24 shrink-0 rounded-art sm:h-32 sm:w-32" eager />
        ) : (
          <div aria-hidden="true" className="skeleton h-24 w-24 shrink-0 rounded-art sm:h-32 sm:w-32" />
        )}
        <div className="min-w-0 flex-1">
          <p className="label-mono mb-2">{TYPE_LABEL[job.type] ?? "Spotify-Link"}</p>
          <h2 className="font-display line-clamp-2 text-2xl font-extrabold leading-[1.05] tracking-[-0.04em] [overflow-wrap:anywhere] sm:text-3xl">
            {job.name || "Spotify-Link wird gelesen…"}
          </h2>
          {!job.name && <p className="mt-2 truncate font-mono text-xs text-muted">{job.url}</p>}
        </div>
      </div>
      <div role="status" aria-live="polite">
        <p className="mb-2 text-sm font-semibold tabular-nums">{importJobSummary(job)}</p>
        <div
          role="progressbar"
          aria-label="Import-Fortschritt"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Der Import läuft im Hintergrund weiter. Du kannst den Import schließen oder woanders hingehen und das
        Ergebnis später hier abholen. Wenn er fertig ist, bekommst du eine Meldung.
      </p>
    </div>
  );
}

function ImportResult({ job, detail, saver }: { job: ImportJobStatus; detail: ImportJobDetail; saver: ImportSaver }) {
  const router = useRouter();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdPlaylist, setCreatedPlaylist] = useState(() => saver.createdPlaylist(job.id));
  const [visible, setVisible] = useState(TRACK_PAGE);
  const result = detail.result;
  if (!result) throw new Error(`Import ${job.id} ist fertig, aber ohne Ergebnis.`);

  async function saveAsPlaylist() {
    if (!result || saver.isSaving) return;
    setSaveError(null);
    setSaving(true);
    try {
      const saved = await saver.save(job.id, result);
      toast.success(`${saved.added} Titel gespeichert.`);
      router.push(playlistPath(saved.playlist));
    } catch (error) {
      setCreatedPlaylist(saver.createdPlaylist(job.id));
      setSaveError(errorDetail(error));
      toast.error(errorDetail(error));
    } finally {
      setSaving(false);
    }
  }

  const matchShare = result.total > 0 ? `${Math.round((result.matched / result.total) * 100)} %` : "–";

  return (
    <div>
      <header className="mb-6 flex items-end gap-4 sm:gap-6">
        <Cover src={result.image} alt={result.name} className="cover-shadow h-24 w-24 rounded-art sm:h-40 sm:w-40" eager />
        <div className="min-w-0 flex-1">
          <p className="label-mono mb-2">{TYPE_LABEL[result.type] ?? result.type}</p>
          <h2 className="font-display line-clamp-3 text-2xl font-extrabold leading-[1.05] tracking-[-0.04em] [overflow-wrap:anywhere] sm:text-4xl">{result.name}</h2>
        </div>
      </header>

      <dl className="mb-6 flex flex-wrap border-y border-hairline">
        <div className="py-3 pr-4 sm:pr-8">
          <dt className="label-mono">Gefunden</dt>
          <dd className="font-display mt-1 text-xl font-extrabold tabular-nums tracking-tight">
            {result.matched}
            <span className="text-subtle">/{result.total}</span>
          </dd>
        </div>
        <div className="border-l border-hairline px-4 py-3 sm:px-8">
          <dt className="label-mono">Trefferquote</dt>
          <dd className="font-display mt-1 text-xl font-extrabold tabular-nums tracking-tight">{matchShare}</dd>
        </div>
        <div className="border-l border-hairline py-3 pl-4 sm:px-8">
          <dt className="label-mono">Fehlen</dt>
          <dd className={`font-display mt-1 text-xl font-extrabold tabular-nums tracking-tight ${result.unmatched.length > 0 ? "text-danger" : ""}`}>{result.unmatched.length}</dd>
        </div>
      </dl>
      {result.source_total > result.total && (
        <p className="-mt-2 mb-6 text-[13px] leading-relaxed text-muted">
          Große Playlist: {result.source_total} Titel insgesamt, die ersten {result.total} wurden verarbeitet.
        </p>
      )}
      {detail.failed_lookups > 0 && (
        <p role="alert" className="error-panel mb-6 [overflow-wrap:anywhere]">
          {detail.failed_lookups} Titel konnten wegen eines Fehlers bei Deezer nicht abgeglichen werden und stehen unter
          „Nicht auf Deezer gefunden“. Erster Fehler: {detail.lookup_error}
        </p>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => playQueue(result.tracks, 0, result.name)}
          disabled={result.tracks.length === 0}
          aria-label="Alle abspielen"
          title="Alle abspielen"
          className="play-fab h-12 w-12"
        >
          <PlayIcon width={20} height={20} />
        </button>
        <button
          type="button"
          onClick={saveAsPlaylist}
          disabled={result.tracks.length === 0 || saving}
          className="action-secondary min-h-11"
        >
          <PlusIcon width={18} height={18} />
          {saving ? "Speichert…" : createdPlaylist ? "Titel erneut speichern" : "Als Playlist speichern"}
        </button>
      </div>

      {saveError && (
        <p role="alert" className="error-panel mb-4 [overflow-wrap:anywhere]">
          {saveError}
        </p>
      )}
      {createdPlaylist && (
        <p className="mb-6 text-sm leading-relaxed text-muted">
          Die Playlist wurde bereits angelegt. Ein erneuter Versuch speichert die Titel dort.{" "}
          <Link href={playlistPath(createdPlaylist)} className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
            Playlist öffnen
          </Link>
        </p>
      )}

      {result.tracks.length === 0 ? (
        <EmptyState title="Keiner dieser Titel ist über Deezer verfügbar">Prüfe den Link oder versuche es mit einer anderen Playlist.</EmptyState>
      ) : (
        <div className="flex flex-col">
          {result.tracks.slice(0, visible).map((track, i) => (
            <TrackRow key={track.id} track={track} index={i} onPlay={() => playQueue(result.tracks, i, result.name)} />
          ))}
          {visible < result.tracks.length && (
            <button
              type="button"
              onClick={() => setVisible((current) => current + TRACK_PAGE * 2)}
              className="action-secondary mt-4 min-h-11 self-start"
            >
              Weitere Titel anzeigen ({result.tracks.length - visible} übrig)
            </button>
          )}
        </div>
      )}

      {result.unmatched.length > 0 && (
        <details className="group mt-8 border-t border-hairline">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span className="font-display text-lg font-bold tracking-tight">Nicht auf Deezer gefunden</span>
            <span className="label-mono flex items-center gap-3 tabular-nums">
              {result.unmatched.length}
              <span aria-hidden="true" className="text-base leading-none transition-transform group-open:rotate-45 motion-reduce:transition-none">+</span>
            </span>
          </summary>
          <ul className="flex flex-col pb-2 text-sm">
            {result.unmatched.map((u, i) => (
              <li key={i} className="flex flex-col gap-0.5 border-t border-hairline py-2.5 [overflow-wrap:anywhere] sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                <span className="min-w-0 font-medium">{u.title}</span>
                <span className="min-w-0 text-muted sm:text-right">{u.artist}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FinishedImport({ job, saver }: { job: ImportJobStatus; saver: ImportSaver }) {
  const detail = useImportJobResult(job);
  if (detail.isError) return <QueryError label="Die importierten Titel" query={detail} className="max-w-3xl" />;
  if (!detail.data) {
    return (
      <div role="status" aria-label="Importierte Titel werden geladen" className="flex items-end gap-4 sm:gap-6">
        <div className="skeleton h-24 w-24 shrink-0 rounded-art sm:h-40 sm:w-40" />
        <div className="min-w-0 flex-1">
          <div className="skeleton mb-3 h-3 w-20 rounded" />
          <div className="skeleton mb-4 h-8 w-2/3 rounded" />
          <div className="skeleton h-3 w-1/3 rounded" />
        </div>
      </div>
    );
  }
  return <ImportResult key={job.id} job={job} detail={detail.data} saver={saver} />;
}

function ImportJobList({
  jobs,
  selectedId,
  removingId,
  onSelect,
  onRemove,
}: {
  jobs: ImportJobStatus[];
  selectedId: string | null;
  removingId: string | null;
  onSelect: (job: ImportJobStatus) => void;
  onRemove: (job: ImportJobStatus) => void;
}) {
  return (
    <section aria-labelledby="import-jobs-heading" className="max-w-3xl">
      <div className="section-heading">
        <h2 id="import-jobs-heading">Deine Importe</h2>
      </div>
      <ul className="flex flex-col">
        {jobs.map((job) => {
          const active = isActiveImport(job);
          const selected = job.id === selectedId;
          return (
            <li key={job.id} className={`flex items-center gap-2 border-t border-hairline first:border-t-0 ${selected ? "bg-white/[0.04]" : ""}`}>
              <button
                type="button"
                onClick={() => onSelect(job)}
                aria-current={selected ? "true" : undefined}
                className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/[0.06]"
              >
                {job.image ? (
                  <Cover src={job.image} alt="" className="h-10 w-10 shrink-0 rounded-md" />
                ) : (
                  <span aria-hidden="true" className={`h-10 w-10 shrink-0 rounded-md bg-white/[0.08] ${active ? "animate-pulse" : ""}`} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{importJobTitle(job)}</span>
                  <span className={`block truncate text-xs tabular-nums ${job.status === "failed" ? "text-danger" : "text-muted"}`}>
                    {importJobSummary(job)}
                  </span>
                  {active && job.total > 0 && (
                    <span aria-hidden="true" className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/[0.08]">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${progressPercent(job)}%` }} />
                    </span>
                  )}
                </span>
                {job.status === "done" && <span className="label-mono shrink-0 text-accent">Öffnen</span>}
              </button>
              <button
                type="button"
                onClick={() => onRemove(job)}
                disabled={removingId === job.id}
                aria-label={active ? `Import abbrechen: ${importJobTitle(job)}` : `Import entfernen: ${importJobTitle(job)}`}
                title={active ? "Abbrechen" : "Entfernen"}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-white/[0.08] hover:text-foreground disabled:opacity-50"
              >
                {active ? <CloseIcon width={16} height={16} /> : <TrashIcon width={16} height={16} />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function ImportPanel() {
  const queryClient = useQueryClient();
  const jobs = useImportJobs();
  const createPlaylist = useCreatePlaylist();
  const [url, setUrl] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saver] = useState(() =>
    createImportSaver({
      createPlaylist: createPlaylist.mutateAsync,
      addTracks: api.addTracksBulk,
    }),
  );

  const start = useMutation({
    mutationFn: (link: string) => api.startImportJob(link),
    onSuccess: (job) => {
      queryClient.setQueryData<ImportJobStatus[]>(IMPORT_JOBS_KEY, (current) => [job, ...(current ?? [])]);
      void queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_KEY });
      setSelectedId(job.id);
      setUrl("");
    },
    onError: (error) => toast.error(errorDetail(error)),
  });

  const remove = useMutation({
    mutationFn: (job: ImportJobStatus) => api.deleteImportJob(job.id),
    onSuccess: (_data, job) => {
      queryClient.setQueryData<ImportJobStatus[]>(IMPORT_JOBS_KEY, (current) =>
        (current ?? []).filter((entry) => entry.id !== job.id));
      queryClient.removeQueries({ queryKey: ["import-job", job.id] });
      setSelectedId((current) => (current === job.id ? null : current));
    },
    onError: (error) => toast.error(`Import konnte nicht entfernt werden: ${errorDetail(error)}`),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const link = url.trim();
    if (!link || start.isPending) return;
    start.mutate(link);
  }

  function removeJob(job: ImportJobStatus) {
    if (
      isActiveImport(job) &&
      !window.confirm(`Import „${importJobTitle(job)}“ abbrechen? Der bisherige Fortschritt geht verloren.`)
    ) {
      return;
    }
    remove.mutate(job);
  }

  const list = jobs.data ?? [];
  const selected = list.find((job) => job.id === selectedId);

  return (
    <div className="flex flex-col gap-8 border-t border-hairline pt-6">
      <form onSubmit={submit} className="max-w-3xl">
        <p className="page-eyebrow">Spotify → Deezer</p>
        <label htmlFor="spotify-import-url" className="font-display block text-2xl font-extrabold leading-tight tracking-[-0.035em] sm:text-3xl">
          Spotify-Link importieren
        </label>
        <p id="spotify-import-hint" className="mb-5 mt-2 text-sm leading-relaxed text-muted">
          Füge den Link zu einer Playlist, einem Album oder einem Titel ein. Der Import läuft im Hintergrund, auch große
          Playlists – du kannst ihn schließen und später hier abholen. Die Titel werden über Deezer abgespielt.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            id="spotify-import-url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (start.isError) start.reset();
            }}
            placeholder="https://open.spotify.com/playlist/…"
            className="field-input min-w-0 flex-1 font-mono text-[13px]"
            type="text"
            inputMode="url"
            autoComplete="off"
            aria-invalid={start.isError ? true : undefined}
            aria-describedby={start.isError ? "spotify-import-error spotify-import-hint" : "spotify-import-hint"}
          />
          <button type="submit" disabled={start.isPending || !url.trim()} className="action-primary min-h-11 w-full sm:w-auto">
            {start.isPending ? "Startet…" : "Importieren"}
          </button>
        </div>
      </form>

      {start.isError && (
        <p id="spotify-import-error" role="alert" className="error-panel max-w-3xl [overflow-wrap:anywhere]">
          Import konnte nicht gestartet werden: {errorDetail(start.error)}
        </p>
      )}

      <QueryError label="Deine Importe" query={jobs} className="max-w-3xl" />

      {list.length > 0 && (
        <ImportJobList
          jobs={list}
          selectedId={selectedId}
          removingId={remove.isPending ? remove.variables.id : null}
          onSelect={(job) => setSelectedId(job.id)}
          onRemove={removeJob}
        />
      )}

      {selected && (
        <section aria-label="Ausgewählter Import">
          {isActiveImport(selected) && <ImportProgress job={selected} />}
          {selected.status === "failed" && (
            <p role="alert" className="error-panel max-w-3xl [overflow-wrap:anywhere]">
              Import „{importJobTitle(selected)}“ fehlgeschlagen: {selected.error ?? "Der Server hat keinen Grund genannt."}
            </p>
          )}
          {selected.status === "done" && <FinishedImport job={selected} saver={saver} />}
        </section>
      )}

    </div>
  );
}
