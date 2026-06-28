"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { useMe } from "@/hooks/useAuth";
import { useCreatePlaylist } from "@/hooks/useLibrary";
import { toast } from "@/store/toast";
import TrackRow from "@/components/TrackRow";
import { PlayIcon, PlusIcon } from "@/components/icons";
import type { ResolveResult } from "@/types";

const TYPE_LABEL: Record<string, string> = {
  playlist: "Playlist",
  album: "Album",
  track: "Titel",
};

export default function ImportPanel() {
  const router = useRouter();
  const { data: me } = useMe();
  const [url, setUrl] = useState("");
  const playQueue = usePlayerStore((s) => s.playQueue);
  const createPlaylist = useCreatePlaylist();
  const [saving, setSaving] = useState(false);

  const resolve = useMutation<ResolveResult, Error, string>({
    mutationFn: (link: string) => api.resolve(link),
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Auflösen fehlgeschlagen.",
      ),
  });

  const result = resolve.data;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (url.trim()) resolve.mutate(url.trim());
  }

  async function saveAsPlaylist() {
    if (!result) return;
    if (!me) {
      router.push("/login");
      return;
    }
    setSaving(true);
    try {
      const pl = await createPlaylist.mutateAsync({
        name: result.name || "Importierte Playlist",
        description: "Von Spotify importiert",
      });
      const res = await api.addTracksBulk(String(pl.id), result.tracks);
      toast.success(`${res.added} Titel gespeichert.`);
      router.push(`/playlist/${pl.id}`);
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="text-muted mb-4">
        Füge einen Spotify-Link (Playlist, Album oder Titel) ein. Die Titel
        werden über Deezer abgespielt.
      </p>

      <form onSubmit={submit} className="mb-8 max-w-2xl flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://open.spotify.com/playlist/…"
          className="flex-1 bg-panel border border-white/15 rounded-full px-5 py-3 outline-none focus:border-accent"
          autoFocus
        />
        <button
          type="submit"
          disabled={resolve.isPending || !url.trim()}
          className="px-6 py-3 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover disabled:opacity-50"
        >
          {resolve.isPending ? "Lädt…" : "Auflösen"}
        </button>
      </form>

      {resolve.isPending && (
        <p className="text-muted">
          Spotify-Link wird aufgelöst und mit Deezer abgeglichen…
        </p>
      )}

      {result && (
        <div>
          <header className="flex items-end gap-6 mb-6">
            {result.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.image}
                alt={result.name}
                className="w-40 h-40 rounded-md object-cover shadow-xl"
              />
            ) : (
              <div className="w-40 h-40 rounded-md bg-panel-hover" />
            )}
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">
                {TYPE_LABEL[result.type] ?? "Import"}
              </p>
              <h2 className="text-4xl font-extrabold mb-2">{result.name}</h2>
              <p className="text-sm text-muted">
                {result.matched} von {result.total} Titeln über Deezer gefunden
                {result.unmatched.length > 0 &&
                  ` · ${result.unmatched.length} nicht verfügbar`}
              </p>
              {result.source_total > result.total && (
                <p className="text-xs text-muted mt-1">
                  Große Playlist: {result.source_total} Titel insgesamt — die
                  ersten {result.total} wurden verarbeitet.
                </p>
              )}
            </div>
          </header>

          <div className="flex items-center gap-3 mb-6">
            <button
              type="button"
              onClick={() => playQueue(result.tracks, 0)}
              disabled={result.tracks.length === 0}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover disabled:opacity-40"
            >
              <PlayIcon /> Alle abspielen
            </button>
            <button
              type="button"
              onClick={saveAsPlaylist}
              disabled={result.tracks.length === 0 || saving}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-white/30 font-semibold hover:border-white/70 disabled:opacity-40"
            >
              <PlusIcon /> {saving ? "Speichert…" : "Als Playlist speichern"}
            </button>
          </div>

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
            <div className="mt-8">
              <h3 className="font-bold mb-2 text-muted">
                Nicht auf Deezer gefunden
              </h3>
              <ul className="text-sm text-muted flex flex-col gap-1">
                {result.unmatched.map((u, i) => (
                  <li key={i} className="truncate">
                    {u.title} — {u.artist}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
