"use client";

import { useId, useState, type FormEvent } from "react";
import { useUpdatePlaylist } from "@/hooks/useLibrary";
import Modal from "@/components/Modal";
import type { Playlist } from "@/types";

/**
 * Rename a playlist and edit its description. Mount it only while open, so
 * the form always starts from the playlist's current values.
 */
export default function EditPlaylistDialog({ id, playlist, onClose }: { id: string; playlist: Playlist; onClose: () => void }) {
  const update = useUpdatePlaylist();
  const formId = useId();
  const errorId = useId();
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? "");
  const [nameError, setNameError] = useState<string | null>(null);

  function save(event: FormEvent) {
    event.preventDefault();
    if (update.isPending) return;
    const nextName = name.trim();
    if (!nextName) {
      setNameError("Gib einen Namen für die Playlist ein.");
      return;
    }
    update.mutate({ id, patch: { name: nextName, description } }, { onSuccess: onClose });
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!update.isPending) onClose();
      }}
      title="Playlist bearbeiten"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={update.isPending} className="action-secondary">
            Abbrechen
          </button>
          <button type="submit" form={formId} disabled={update.isPending} className="action-primary">
            {update.isPending ? "Wird gespeichert…" : "Speichern"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={save} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Name
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
            }}
            required
            maxLength={200}
            data-dialog-autofocus
            disabled={update.isPending}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? errorId : undefined}
            className="field-input font-normal"
          />
          {nameError && (
            <span id={errorId} role="alert" className="font-normal text-danger">
              {nameError}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Beschreibung
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={update.isPending}
            rows={3}
            placeholder="Worum geht es in dieser Playlist?"
            className="field-input resize-none font-normal"
          />
        </label>
        {update.isError && (
          <p role="alert" className="error-panel">
            Playlist konnte nicht gespeichert werden: {update.error.message}
          </p>
        )}
      </form>
    </Modal>
  );
}
