"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { useCreatePlaylist } from "@/hooks/useLibrary";

export default function CreatePlaylistDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createPlaylist = useCreatePlaylist();

  return (
    <Modal
      open={open}
      title="Playlist erstellen"
      description="Gib ihr einen Namen – Titel fügst du danach hinzu."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="action-secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="submit"
            form="library-playlist-form"
            className="action-primary"
            disabled={!name.trim() || createPlaylist.isPending}
          >
            {createPlaylist.isPending ? "Wird erstellt…" : "Playlist erstellen"}
          </button>
        </>
      }
    >
      <form
        id="library-playlist-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || createPlaylist.isPending) return;
          createPlaylist.mutate(
            { name: name.trim(), description: description.trim() || undefined },
            {
              onSuccess: () => {
                setName("");
                setDescription("");
                onClose();
              },
            },
          );
        }}
        className="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-2">
          <label className="label-mono flex items-baseline justify-between gap-3" htmlFor="library-playlist-name">
            <span>Name</span>
            <span aria-hidden="true" className="tabular-nums">
              {name.length}/200
            </span>
          </label>
          <input
            id="library-playlist-name"
            className="field-input font-display text-lg font-bold tracking-tight placeholder:font-semibold"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Meine neue Playlist"
            maxLength={200}
            autoComplete="off"
            required
            data-dialog-autofocus
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="label-mono flex items-baseline justify-between gap-3" htmlFor="library-playlist-description">
            <span>Beschreibung</span>
            <span>Optional</span>
          </label>
          <textarea
            id="library-playlist-description"
            className="field-input min-h-24 resize-y text-sm leading-relaxed"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        {createPlaylist.isError && (
          <p role="alert" className="error-panel">
            Die Playlist konnte nicht erstellt werden:{" "}
            {createPlaylist.error.message}
          </p>
        )}
      </form>
    </Modal>
  );
}
