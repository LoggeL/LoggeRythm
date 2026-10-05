"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/hooks/useDialogFocus";

export default function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(open, panelRef);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="pop-in bg-panel rounded-lg p-5 w-[min(92vw,28rem)] max-h-[85dvh] overflow-y-auto shadow-xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="text-muted hover:text-foreground p-1 rounded-full hover:bg-panel-hover"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
