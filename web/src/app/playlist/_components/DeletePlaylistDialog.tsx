"use client";

import { useRouter } from "next/navigation";
import { useDeletePlaylist } from "@/hooks/useLibrary";
import Modal from "@/components/Modal";

/** Confirms deleting a playlist, then returns to the library. */
export default function DeletePlaylistDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const router = useRouter();
  const remove = useDeletePlaylist();

  return (
    <Modal
      open
      size="sm"
      onClose={() => {
        if (!remove.isPending) onClose();
      }}
      title="Playlist löschen?"
      description={<>„{name}“ wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.</>}
      footer={
        <>
          <button type="button" data-dialog-autofocus onClick={onClose} disabled={remove.isPending} className="action-secondary">
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => {
              if (!remove.isPending) remove.mutate(id, { onSuccess: () => router.push("/library") });
            }}
            disabled={remove.isPending}
            className="action-secondary action-danger border-danger/40 hover:border-danger/70"
          >
            {remove.isPending ? "Wird gelöscht…" : "Löschen"}
          </button>
        </>
      }
    >
      {remove.isError ? (
        <p role="alert" className="error-panel">
          Playlist konnte nicht gelöscht werden: {remove.error.message}
        </p>
      ) : null}
    </Modal>
  );
}
