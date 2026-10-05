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
import CoverPlaceholder from "@/components/CoverPlaceholder";
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

  return (
    <div className="animate-in">
      <p className="page-description mb-6">
        Füge einen Spotify-Link (Playlist, Album oder Titel) ein. Die Titel
        werden über Deezer abgespielt.
      </p>

      <form onSubmit={submit} className="mb-8 max-w-3xl">
        <label
          htmlFor="spotify-import-url"
          className="mb-2 block text-sm font-medium"
        >
          Spotify-Link
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            id="spotify-import-url"
            value={url}
            onChange={(e) => editUrl(e.target.value)}
            placeholder="https://open.spotify.com/playlist/…"
            className="field-input min-w-0 flex-1"
          type="text"
          inputMode="url"
            autoComplete="off"
            disabled={saving}
            aria-invalid={resolveError ? true : undefined}
            aria-describedby={resolveError ? "spotify-import-error" : undefined}
          />
          <button
            type="submit"
            disabled={resolving || saving || !url.trim()}
            className="action-primary w-full sm:w-auto"
          >
            {resolving ? "Lädt…" : "Auflösen"}
          </button>
        </div>
      </form>

      {resolveError && (
        <p id="spotify-import-error" role="alert" className="error-panel mb-6">
          {resolveError}
        </p>
      )}
      {account.isError && (
        <p role="alert" className="error-panel mb-6">
          Dein Konto konnte nicht geladen werden: {account.error.message}
        </p>
      )}
      {resolving && (
        <p role="status" className="text-muted">
          Spotify-Link wird aufgelöst und mit Deezer abgeglichen…
        </p>
      )}

      {result && (
        <div>
          <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-7">
            {result.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.image}
                alt={result.name}
                className="h-44 w-44 shrink-0 rounded-2xl object-cover sm:h-52 sm:w-52"
              />
            ) : (
              <CoverPlaceholder className="h-44 w-44 shrink-0 rounded-2xl sm:h-52 sm:w-52" />
            )}
            <div className="min-w-0">
              <p className="page-eyebrow">
                {TYPE_LABEL[result.type] ?? "Import"}
              </p>
              <h2 className="page-title mb-3">{result.name}</h2>
              <p className="text-sm leading-relaxed text-muted">
                {result.matched} von {result.total} Titeln über Deezer gefunden
                {result.unmatched.length > 0 &&
                  ` · ${result.unmatched.length} nicht verfügbar`}
              </p>
              {result.source_total > result.total && (
                <p className="text-xs text-muted mt-1">
                  Große Playlist: {result.source_total} Titel insgesamt, die
                  ersten {result.total} wurden verarbeitet.
                </p>
              )}
            </div>
          </header>

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => playQueue(result.tracks, 0)}
              disabled={result.tracks.length === 0}
              className="action-primary"
            >
              <PlayIcon /> Alle abspielen
            </button>
            <button
              type="button"
              onClick={saveAsPlaylist}
              disabled={
                result.tracks.length === 0 ||
                saving ||
                account.isLoading ||
                account.isError
              }
              className="action-secondary"
            >
              <PlusIcon />{" "}
              {saving
                ? "Speichert…"
                : createdPlaylist
                  ? "Titel erneut speichern"
                  : "Als Playlist speichern"}
            </button>
          </div>

          {saveError && (
            <p role="alert" className="error-panel mb-4">
              {saveError}
            </p>
          )}
          {createdPlaylist && (
            <p className="mb-6 text-sm leading-relaxed text-muted">
              Die Playlist wurde bereits angelegt. Ein erneuter Versuch
              speichert die Titel dort.{" "}
              <Link
                href={playlistPath(createdPlaylist)}
                className="text-foreground underline"
              >
                Playlist öffnen
              </Link>
            </p>
          )}

          <div className="flex flex-col">
            {result.tracks.map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                index={i}
                onPlay={() => playQueue(result.tracks, i)}
              />
            ))}
          </div>

          {result.unmatched.length > 0 && (
            <details className="surface-card mt-8 p-4 sm:p-5">
              <summary className="cursor-pointer text-sm font-semibold">
                Nicht auf Deezer gefunden
                <span className="ml-2 text-muted">
                  {result.unmatched.length}
                </span>
              </summary>
              <ul className="mt-4 flex flex-col gap-2 text-sm text-muted">
                {result.unmatched.map((u, i) => (
                  <li key={i} className="break-words">
                    {u.title} · {u.artist}
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
