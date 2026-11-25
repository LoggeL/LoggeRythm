"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { playlistPath } from "@/lib/slugs";
import { useSaveAsPlaylistStore } from "@/store/saveAsPlaylist";
import { toast } from "@/store/toast";
import Modal from "@/components/Modal";
import type { PlaylistSummary } from "@/types";

const FORM_ID = "save-as-playlist-form";

export default function SaveAsPlaylistModal() {
  const draft = useSaveAsPlaylistStore((s) => s.draft);
  const session = useSaveAsPlaylistStore((s) => s.session);
  const close = useSaveAsPlaylistStore((s) => s.close);
  const qc = useQueryClient();
  const router = useRouter();

  const [lastSession, setLastSession] = useState(session);
  const [name, setName] = useState(draft?.defaultName ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [collaborative, setCollaborative] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PlaylistSummary | null>(null);

  if (session !== lastSession) {
    setLastSession(session);
    setName(draft?.defaultName ?? "");
    setDescription(draft?.description ?? "");
    setCollaborative(false);
    setSaving(false);
    setError(null);
    setCreated(null);
  }

  if (!draft) return null;

  const trimmed = name.trim();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const playlist =
        created ??
        (await api.createPlaylist(trimmed, description.trim() || undefined, collaborative));
      setCreated(playlist);
      const result = await api.addTracksBulk(String(playlist.id), draft.tracks);
      void qc.invalidateQueries({ queryKey: ["playlists"] });
      void qc.invalidateQueries({ queryKey: ["playlist", String(playlist.id)] });
      toast.success(`„${playlist.name}“ mit ${result.added} Titeln gespeichert.`);
      close();
      router.push(playlistPath(playlist));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`Playlist konnte nicht gespeichert werden: ${detail}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!saving) close();
      }}
      title="Als Playlist speichern"
      description={`${draft.tracks.length} ${draft.tracks.length === 1 ? "Titel wird" : "Titel werden"} in eine neue Playlist übernommen.`}
      footer={
        <>
          <button type="button" onClick={close} disabled={saving} className="action-secondary">
            Abbrechen
          </button>
          <button type="submit" form={FORM_ID} disabled={saving || !trimmed} className="action-primary">
            {saving ? "Speichert…" : created ? "Titel erneut speichern" : "Playlist speichern"}
          </button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4 pt-1">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Name
          <input
            data-dialog-autofocus
            type="text"
            required
            maxLength={120}
            value={name}
            disabled={saving || Boolean(created)}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name der Playlist"
            className="field-input font-normal"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Beschreibung (optional)
          <input
            type="text"
            maxLength={240}
            value={description}
            disabled={saving || Boolean(created)}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Worum geht es in dieser Playlist?"
            className="field-input font-normal"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={collaborative}
            disabled={saving || Boolean(created)}
            onChange={(event) => setCollaborative(event.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span>Als gemeinsame Playlist anlegen</span>
        </label>
        {error && (
          <p role="alert" className="error-panel [overflow-wrap:anywhere]">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
