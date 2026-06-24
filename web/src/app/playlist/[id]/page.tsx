"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import {
  usePlaylist,
  useRemoveFromPlaylist,
  useReorderPlaylist,
  useUpdatePlaylist,
  useDeletePlaylist,
} from "@/hooks/useLibrary";
import { usePlayerStore } from "@/store/player";
import { useMe } from "@/hooks/useAuth";
import TrackRow from "@/components/TrackRow";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon, EditIcon, TrashIcon } from "@/components/icons";

export default function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: me } = useMe();
  const { data, isLoading, isError } = usePlaylist(id);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const removeFromPlaylist = useRemoveFromPlaylist();
  const reorder = useReorderPlaylist();
  const updatePlaylist = useUpdatePlaylist();
  const deletePlaylist = useDeletePlaylist();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (isLoading)
    return (
      <div>
        <DetailHeaderSkeleton />
        <RowListSkeleton />
      </div>
    );
  if (isError || !data)
    return <p className="text-red-400">Playlist nicht gefunden.</p>;

  const tracks = data.tracks ?? [];

  function startEdit() {
    setName(data!.name);
    setDescription(data!.description ?? "");
    setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    await updatePlaylist.mutateAsync({ id, patch: { name, description } });
    setEditing(false);
  }

  async function handleDelete() {
    if (!window.confirm("Diese Playlist wirklich löschen?")) return;
    await deletePlaylist.mutateAsync(id);
    router.push("/library");
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= tracks.length) return;
    const ids = tracks.map((t) => String(t.id));
    const [m] = ids.splice(from, 1);
    ids.splice(to, 0, m);
    reorder.mutate({ id, deezerIds: ids });
  }

  return (
    <div>
      <header className="flex items-end gap-6 mb-6">
        {data.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.cover_url}
            alt={data.name}
            className="w-40 h-40 rounded-md object-cover shadow-xl"
          />
        ) : (
          <div className="w-40 h-40 rounded-md bg-gradient-to-br from-accent to-[#3a2a6a] flex items-center justify-center text-5xl shadow-xl">
            ♪
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">Playlist</p>
          <h1 className="text-4xl font-extrabold mb-2 truncate">{data.name}</h1>
          {data.description && <p className="text-muted">{data.description}</p>}
          <p className="text-sm text-muted mt-1">{tracks.length} Titel</p>
        </div>
      </header>

      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => playQueue(tracks, 0)}
          disabled={tracks.length === 0}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover disabled:opacity-40"
        >
          <PlayIcon /> Alle abspielen
        </button>
        {me && (
          <>
            <button
              type="button"
              onClick={startEdit}
              aria-label="Playlist bearbeiten"
              title="Bearbeiten"
              className="text-muted hover:text-foreground p-2 rounded-full hover:bg-panel-hover"
            >
              <EditIcon />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Playlist löschen"
              title="Löschen"
              className="text-muted hover:text-red-400 p-2 rounded-full hover:bg-panel-hover"
            >
              <TrashIcon />
            </button>
          </>
        )}
      </div>

      {editing && (
        <form
          onSubmit={saveEdit}
          className="mb-6 bg-panel rounded-lg p-4 max-w-lg flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="bg-background border border-white/15 rounded px-3 py-2 outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Beschreibung
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="bg-background border border-white/15 rounded px-3 py-2 outline-none focus:border-accent resize-none"
            />
          </label>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-4 py-2 rounded-full text-muted hover:text-foreground"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover"
            >
              Speichern
            </button>
          </div>
        </form>
      )}

      {tracks.length === 0 ? (
        <p className="text-muted">Diese Playlist ist leer.</p>
      ) : (
        <div className="flex flex-col">
          {tracks.map((track, i) => (
            <TrackRow
              key={track.id}
              track={track}
              index={i}
              onPlay={() => playQueue(tracks, i)}
              onRemove={() =>
                removeFromPlaylist.mutate({ id, deezerId: String(track.id) })
              }
              onMoveUp={i > 0 ? () => move(i, i - 1) : undefined}
              onMoveDown={i < tracks.length - 1 ? () => move(i, i + 1) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
