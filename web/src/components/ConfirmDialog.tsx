"use client";

import type { ReactNode } from "react";
import Modal from "@/components/Modal";

/**
 * Asks before an action that cannot be undone. The safe choice ("Abbrechen")
 * receives initial focus so Enter never confirms by accident.
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Abbrechen",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** What will happen, in one or two sentences. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Disables both buttons while the confirmed action is running. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onCancel}
      title={title}
      description={children}
      size="sm"
      footer={
        <>
          <button type="button" data-dialog-autofocus onClick={onCancel} disabled={busy} className="action-secondary">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={destructive ? "action-secondary action-danger border-danger/45 hover:border-danger hover:bg-danger/10" : "action-primary"}
          >
            {busy ? "Bitte warten…" : confirmLabel}
          </button>
        </>
      }
    />
  );
}
