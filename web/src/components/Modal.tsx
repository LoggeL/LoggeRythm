"use client";

import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { CloseIcon } from "@/components/icons";

const WIDTHS = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-xl" } as const;

/**
 * Modal dialog. A centred card on larger screens, a bottom sheet on phones.
 * Focus is trapped while open, Escape and the backdrop close it, and focus
 * returns to the trigger afterwards.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional sentence under the title explaining the dialog. */
  description?: ReactNode;
  /** Action row pinned to the bottom of the dialog. */
  footer?: ReactNode;
  size?: keyof typeof WIDTHS;
  children?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogFocus(open, panelRef, onClose);

  if (!open || typeof document === "undefined") return null;

  const hasBody = children !== undefined && children !== null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-backdrop/80 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[88dvh] w-full flex-col rounded-t-[var(--radius-panel)] border border-hairline bg-panel shadow-[0_24px_60px_rgb(0_0_0/0.55)] outline-none animate-[sheetUp_.32s_var(--ease-out)_both] motion-reduce:animate-none max-sm:border-x-0 max-sm:border-b-0 sm:rounded-[var(--radius-panel)] sm:animate-[popIn_.2s_var(--ease-out)_both] ${WIDTHS[size]}`}
      >
        <div aria-hidden="true" className="mx-auto mt-2.5 h-[3px] w-8 shrink-0 rounded-full bg-foreground/20 sm:hidden" />
        <div className={`flex shrink-0 items-start justify-between gap-4 px-5 pt-3 sm:px-6 sm:pt-5 ${hasBody ? "pb-4" : "pb-5"}`}>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display line-clamp-2 text-[1.375rem] font-extrabold leading-[1.15] tracking-[-0.03em] [overflow-wrap:anywhere]">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted">
                {description}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" className="action-icon -mr-2 -mt-1.5 h-10 min-h-10 w-10">
            <CloseIcon width={18} height={18} />
          </button>
        </div>
        {hasBody && (
          <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>
        )}
        {footer && (
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-hairline px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:justify-end sm:px-6 sm:pb-4">
            {footer}
          </div>
        )}
        {!footer && <div aria-hidden="true" className="shrink-0 pb-[env(safe-area-inset-bottom)]" />}
      </div>
    </div>,
    document.body,
  );
}
