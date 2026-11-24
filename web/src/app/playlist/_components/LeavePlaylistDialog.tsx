"use client";

import { useRouter } from "next/navigation";
import { useLeavePlaylist } from "@/hooks/useLibrary";
import Modal from "@/components/Modal";

/** Confirms leaving a shared/collaborative playlist, then returns to the library. */
export default function LeavePlaylistDialog({
  id,
  name,
  onClose,
  onLeft,
}: {
  id: string;
  name: string;
  onClose: () => void;
  /** Optional custom post-leave callback; defaults to navigating to `/library`. */
  onLeft?: () => void;
}) {
  const router = useRouter();
  const leave = useLeavePlaylist();

  return (
    <Modal
      open
      size="sm"
      onClose={() => {
        if (!leave.isPending) onClose();
      }}
      title="Playlist verlassen?"
      description={
        <>
          Du wirst als Mitwirkende:r aus „{name}“ entfernt und kannst keine Titel
          mehr bearbeiten. Bei einer privaten Playlist brauchst du danach eine
          neue Einladung.
        </>
      }
      footer={
        <>
          <button
            type="button"
            data-dialog-autofocus
            onClick={onClose}
            disabled={leave.isPending}
            className="action-secondary"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => {
              if (!leave.isPending) {
                leave.mutate(id, {
                  onSuccess: () => {
                    onClose();
                    if (onLeft) onLeft();
                    else router.push("/library");
                  },
                });
              }
            }}
            disabled={leave.isPending}
            className="action-secondary action-danger border-danger/40 hover:border-danger/70"
          >
            {leave.isPending ? "Wird verlassen…" : "Verlassen"}
          </button>
        </>
      }
    >
      {leave.isError ? (
        <p role="alert" className="error-panel">
          Playlist konnte nicht verlassen werden: {leave.error.message}
        </p>
      ) : null}
    </Modal>
  );
}
