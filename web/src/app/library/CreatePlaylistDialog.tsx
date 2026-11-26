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
  const [isCollaborative, setIsCollaborative] = useState(false);
  const createPlaylist = useCreatePlaylist();

  return (
    <Modal
      open={open}
      title="Playlist erstellen"
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
            {
              name: name.trim(),
              description: description.trim() || undefined,
              is_collaborative: isCollaborative,
            },
            {
              onSuccess: () => {
                setName("");
                setDescription("");
                setIsCollaborative(false);
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
        <div className="flex items-start justify-between gap-4 rounded-[var(--radius-control)] border border-hairline bg-foreground/[0.03] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              Gemeinsame Playlist
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Lade andere per Link oder E-Mail ein, gemeinsam Titel zu sammeln.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isCollaborative}
            disabled={createPlaylist.isPending}
            onClick={() => setIsCollaborative((value) => !value)}
            className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
              isCollaborative
                ? "border-accent bg-accent"
                : "border-border bg-white/10"
            }`}
          >
            <span className="sr-only">Gemeinsame Playlist</span>
            <span
              aria-hidden="true"
              className={`h-5 w-5 rounded-full transition-transform ${
                isCollaborative
                  ? "translate-x-6 bg-on-accent"
                  : "translate-x-1 bg-foreground"
              }`}
            />
          </button>
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
