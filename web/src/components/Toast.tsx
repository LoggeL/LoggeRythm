"use client";

import { useToastStore, type ToastKind } from "@/store/toast";
import { CloseIcon } from "@/components/icons";
import { AlertCircleIcon, CheckCircleIcon, InfoCircleIcon } from "@/components/feedbackIcons";

const KINDS: Record<ToastKind, { icon: typeof InfoCircleIcon; tone: string }> = {
  success: { icon: CheckCircleIcon, tone: "text-success" },
  error: { icon: AlertCircleIcon, tone: "text-danger" },
  info: { icon: InfoCircleIcon, tone: "text-muted" },
};

/**
 * Toast stack. Bottom-right above the player bar on desktop; on phones it
 * sits above the mini player and tab bar so it never covers the transport.
 * While the install hint (`data-install-hint`, PwaBanner) is on screen the
 * stack lifts by that hint's height plus a gap, so the two never overlap.
 */
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-label="Benachrichtigungen"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(9.75rem+var(--toast-lift)+env(safe-area-inset-bottom))] z-[130] flex flex-col items-center gap-1.5 [--toast-lift:0rem] lg:inset-x-auto lg:bottom-[calc(7rem+var(--toast-lift))] lg:right-5 lg:items-end [body:has([data-install-hint])_&]:[--toast-lift:4.25rem]"
    >
      {toasts.map((t) => {
        const { icon: Icon, tone } = KINDS[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pop-in pointer-events-auto flex w-full max-w-[22rem] items-start gap-2.5 rounded-[var(--radius-control)] border bg-panel py-1 pl-3 pr-1 text-[13px] text-foreground shadow-[0_12px_32px_rgb(0_0_0/0.5)] ${t.kind === "error" ? "border-danger/40" : "border-border"}`}
          >
            <Icon width={17} height={17} className={`mt-[9px] shrink-0 ${tone}`} />
            <p className="min-w-0 flex-1 break-words py-2 font-medium leading-snug">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Benachrichtigung schließen" className="action-icon h-9 min-h-9 w-9">
              <CloseIcon width={14} height={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
