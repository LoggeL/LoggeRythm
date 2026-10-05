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
    <Modal open={open} title="Playlist erstellen" onClose={onClose}>
      <form
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
        className="flex flex-col gap-4"
      >
        <label className="text-sm font-medium" htmlFor="library-playlist-name">
          Name
          <input
            id="library-playlist-name"
            className="field-input mt-2 w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Meine neue Playlist"
            maxLength={200}
            required
            autoFocus
          />
        </label>
        <label
          className="text-sm font-medium"
          htmlFor="library-playlist-description"
        >
          Beschreibung{" "}
          <span className="text-muted font-normal">(optional)</span>
          <textarea
            id="library-playlist-description"
            className="field-input mt-2 w-full min-h-24 resize-y"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {createPlaylist.isError && (
          <p role="alert" className="error-panel">
            Die Playlist konnte nicht erstellt werden:{" "}
            {createPlaylist.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <button type="button" className="action-secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="submit"
            className="action-primary"
            disabled={!name.trim() || createPlaylist.isPending}
          >
            {createPlaylist.isPending ? "Wird erstellt…" : "Playlist erstellen"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
