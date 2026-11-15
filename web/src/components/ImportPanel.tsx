"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { playlistPath } from "@/lib/slugs";
import { usePlayerStore } from "@/store/player";
import { useMe } from "@/hooks/useAuth";
import { useCreatePlaylist } from "@/hooks/useLibrary";
import { toast } from "@/store/toast";
import TrackRow from "@/components/TrackRow";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import { PlayIcon, PlusIcon } from "@/components/icons";
import type { PlaylistSummary, ResolveResult, Track } from "@/types";

const TYPE_LABEL: Record<string, string> = {
  playlist: "Playlist",
  album: "Album",
  track: "Titel",
};

type ImportOperations = {
  resolve: (link: string) => Promise<ResolveResult>;
  createPlaylist: (input: {
    name: string;
    description: string;
  }) => Promise<PlaylistSummary>;
  addTracks: (id: string, tracks: Track[]) => Promise<{ added: number }>;
};

function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Owns request generations and the playlist created for each source link. */
export function createImportSession(operations: ImportOperations) {
  let generation = 0;
  let resolving = false;
  let saving = false;
  let resolved: { link: string; result: ResolveResult } | null = null;
  const createdPlaylists = new Map<string, PlaylistSummary>();

  return {
    get isResolving() {
      return resolving;
    },
    get isSaving() {
      return saving;
    },
    get createdPlaylist() {
      return resolved ? createdPlaylists.get(resolved.link) : undefined;
    },
    invalidate() {
      if (saving)
        throw new Error(
          "Der Spotify-Link kann während des Speicherns nicht geändert werden.",
        );
      generation += 1;
      resolving = false;
      resolved = null;
    },
    async resolve(
      link: string,
    ): Promise<
      { status: "resolved"; result: ResolveResult } | { status: "superseded" }
    > {
      if (saving) throw new Error("Die Playlist wird gerade gespeichert.");
      if (resolving)
        throw new Error("Der Spotify-Link wird bereits aufgelöst.");
      if (!link.trim()) throw new Error("Gib einen Spotify-Link ein.");
      const requestGeneration = ++generation;
      resolving = true;
      resolved = null;
      try {
        const result = await operations.resolve(link);
        // An edited link invalidates the earlier request, including its errors.
        if (generation !== requestGeneration) return { status: "superseded" };
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
        resolved = { link, result };
        return { status: "resolved", result };
      } catch (error) {
        if (generation !== requestGeneration) return { status: "superseded" };
        throw new Error(`Auflösen fehlgeschlagen: ${errorDetail(error)}`, {
          cause: error,
        });
      } finally {
        if (generation === requestGeneration) resolving = false;
      }
    },
    async save() {
      if (saving) throw new Error("Die Playlist wird bereits gespeichert.");
      if (!resolved) throw new Error("Löse zuerst einen Spotify-Link auf.");
      if (resolved.result.tracks.length === 0)
        throw new Error("Es sind keine Deezer-Titel zum Speichern verfügbar.");
      saving = true;
      const { link, result } = resolved;
      try {
        let playlist = createdPlaylists.get(link);
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
            createdPlaylists.set(link, playlist);
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

export default function ImportPanel() {
  const router = useRouter();
  const account = useMe();
  const me = account.data;
  const [url, setUrl] = useState("");
  const playQueue = usePlayerStore((s) => s.playQueue);
  const createPlaylist = useCreatePlaylist();
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdPlaylist, setCreatedPlaylist] = useState<
    PlaylistSummary | undefined
  >();
  const [session] = useState(() =>
    createImportSession({
      resolve: api.resolve,
      createPlaylist: createPlaylist.mutateAsync,
      addTracks: api.addTracksBulk,
    }),
  );

  function editUrl(value: string) {
    session.invalidate();
    setUrl(value);
    setResult(null);
    setResolving(false);
    setResolveError(null);
    setSaveError(null);
    setCreatedPlaylist(undefined);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || session.isResolving || session.isSaving) return;
    setResolving(true);
    setResult(null);
    setResolveError(null);
    setSaveError(null);
    setCreatedPlaylist(undefined);
    try {
      const resolution = await session.resolve(url.trim());
      if (resolution.status === "resolved") {
        setResult(resolution.result);
        setCreatedPlaylist(session.createdPlaylist);
        setResolving(false);
      }
    } catch (error) {
      setResolving(false);
      setResolveError(errorDetail(error));
      toast.error(errorDetail(error));
    }
  }

  async function saveAsPlaylist() {
    if (session.isSaving) return;
    if (!me) {
      router.push("/login");
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      const saved = await session.save();
      toast.success(`${saved.added} Titel gespeichert.`);
      router.push(playlistPath(saved.playlist));
    } catch (error) {
      setCreatedPlaylist(session.createdPlaylist);
      setSaveError(errorDetail(error));
      toast.error(errorDetail(error));
    } finally {
      setSaving(false);
    }
  }

  const matchShare = result && result.total > 0 ? `${Math.round((result.matched / result.total) * 100)} %` : "–";

  return (
    <div className="flex flex-col gap-8 border-t border-hairline pt-6">
      <form onSubmit={submit} className="max-w-3xl">
        <p className="page-eyebrow">Spotify → Deezer</p>
        <label htmlFor="spotify-import-url" className="font-display block text-2xl font-extrabold leading-tight tracking-[-0.035em] sm:text-3xl">
          Spotify-Link importieren
        </label>
        <p id="spotify-import-hint" className="mb-5 mt-2 text-sm leading-relaxed text-muted">
          Füge den Link zu einer Playlist, einem Album oder einem Titel ein. Die Titel werden über Deezer abgespielt.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            id="spotify-import-url"
            value={url}
            onChange={(e) => editUrl(e.target.value)}
            placeholder="https://open.spotify.com/playlist/…"
            className="field-input min-w-0 flex-1 font-mono text-[13px]"
            type="text"
            inputMode="url"
            autoComplete="off"
            disabled={saving}
            aria-invalid={resolveError ? true : undefined}
            aria-describedby={resolveError ? "spotify-import-error spotify-import-hint" : "spotify-import-hint"}
          />
          <button type="submit" disabled={resolving || saving || !url.trim()} className="action-primary min-h-11 w-full sm:w-auto">
            {resolving ? "Lädt…" : "Auflösen"}
          </button>
        </div>
      </form>

      {resolveError && (
        <p id="spotify-import-error" role="alert" className="error-panel max-w-3xl [overflow-wrap:anywhere]">
          {resolveError}
        </p>
      )}
      {account.isError && (
        <p role="alert" className="error-panel max-w-3xl">
          Dein Konto konnte nicht geladen werden: {account.error.message}
        </p>
      )}
      {resolving && (
        <div role="status">
          <p className="label-mono mb-5">Spotify-Link wird aufgelöst und mit Deezer abgeglichen…</p>
          <div aria-hidden="true" className="flex items-end gap-4 sm:gap-6">
            <div className="skeleton h-24 w-24 shrink-0 rounded-art sm:h-40 sm:w-40" />
            <div className="min-w-0 flex-1">
              <div className="skeleton mb-3 h-3 w-20 rounded" />
              <div className="skeleton mb-4 h-8 w-2/3 rounded" />
              <div className="skeleton h-3 w-1/3 rounded" />
            </div>
          </div>
        </div>
      )}

      {result && (
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
              disabled={result.tracks.length === 0 || saving || account.isLoading || account.isError}
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
              {result.tracks.map((track, i) => (
                <TrackRow key={track.id} track={track} index={i} onPlay={() => playQueue(result.tracks, i, result.name)} />
              ))}
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
      )}
    </div>
  );
}
