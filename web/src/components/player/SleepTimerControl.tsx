"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePlayerStore } from "@/store/player";
import { useUiModalsStore } from "@/store/uiModals";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { CloseIcon, MoonIcon } from "@/components/icons";

export const SLEEP_TIMER_PRESETS = [15, 30, 45, 60] as const;

let clockNow = 0;
const clockListeners = new Set<() => void>();
let clockTimer: number | null = null;

function subscribeSecondClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (typeof window !== "undefined") {
    clockNow = Date.now();
    if (clockTimer === null) {
      clockTimer = window.setInterval(() => {
        clockNow = Date.now();
        for (const cb of clockListeners) cb();
      }, 1000);
    }
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0) {
      if (clockTimer !== null) {
        window.clearInterval(clockTimer);
        clockTimer = null;
      }
      clockNow = 0;
    }
  };
}

function noopSubscribe(): () => void {
  return () => {};
}

function getSecondClockSnapshot(): number {
  return clockNow;
}

function getInactiveClockSnapshot(): number {
  return 0;
}

function useSecondClock(active: boolean): number {
  return useSyncExternalStore(
    active ? subscribeSecondClock : noopSubscribe,
    active ? getSecondClockSnapshot : getInactiveClockSnapshot,
    getInactiveClockSnapshot,
  );
}

export function formatSleepRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export interface SleepTimerStatus {
  sleepAt: number | null;
  sleepAfterTrack: boolean;
  armed: boolean;
  remaining: string | null;
  statusLabel: string;
  endsAt: string | null;
}

/** Shared live sleep-timer snapshot for triggers, popovers, and consolidated audio controls. */
export function useSleepTimerStatus(): SleepTimerStatus {
  const sleepAt = usePlayerStore((s) => s.sleepAt);
  const sleepAfterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const now = useSecondClock(sleepAt != null);

  const armed = sleepAt != null || sleepAfterTrack;
  const countdown = sleepAt != null ? formatSleepRemaining(now > 0 ? sleepAt - now : 0) : null;
  const remaining = countdown ?? (sleepAfterTrack ? "1×" : null);
  const statusLabel = countdown ?? (sleepAfterTrack ? "Titelende" : "Aus");
  const endsAt =
    sleepAt == null
      ? null
      : new Date(sleepAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  return { sleepAt, sleepAfterTrack, armed, remaining, statusLabel, endsAt };
}

/**
 * Compact Sleep-Timer trigger button for NowPlaying. Shows a live countdown
 * badge when armed. The popover itself is mounted once via `<SleepTimerHost />`.
 */
export function SleepTimerTrigger({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const { sleepAt, armed, remaining } = useSleepTimerStatus();
  const open = useUiModalsStore((s) => s.sleepTimerOpen);
  const setOpen = useUiModalsStore((s) => s.setSleepTimerOpen);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const label = armed
    ? sleepAt != null
      ? `Sleep-Timer aktiv (${remaining})`
      : "Sleep-Timer aktiv (Ende des Titels)"
    : "Sleep-Timer";

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => setOpen(!open, buttonRef.current)}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-pressed={armed || open}
      title={label}
      className={`action-icon relative ${armed && !compact ? "w-auto px-2.5 gap-1.5" : compact ? "h-10 w-10" : "h-9 w-9"} ${
        armed ? "text-accent" : ""
      } ${className}`}
    >
      <MoonIcon width={17} height={17} aria-hidden="true" />
      {armed && !compact && (
        <span className="font-mono text-[11px] font-semibold tabular-nums">{remaining}</span>
      )}
      {armed && compact && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent-soft"
        />
      )}
    </button>
  );
}

/** Inline Sleep-Timer section embedded inside the consolidated audio popover. */
export function SleepTimerSection() {
  const { sleepAt, sleepAfterTrack, armed, statusLabel, endsAt } = useSleepTimerStatus();
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const setSleepAfterTrack = usePlayerStore((s) => s.setSleepAfterTrack);

  return (
    <div className="space-y-2 border-t border-hairline pt-2.5" data-sleep-timer-section="">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <MoonIcon
            width={14}
            height={14}
            className={armed ? "shrink-0 text-accent" : "shrink-0 text-muted"}
            aria-hidden="true"
          />
          Sleep-Timer
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-xs tabular-nums ${
              armed ? "font-semibold text-accent" : "text-muted"
            }`}
          >
            {statusLabel}
          </span>
          {armed && (
            <button
              type="button"
              onClick={() => setSleepTimer(null)}
              className="action-secondary min-h-7 px-2 text-[11px]"
            >
              Stoppen
            </button>
          )}
        </div>
      </div>

      {armed && (
        <p className="font-mono text-[10.5px] text-muted">
          {sleepAt != null ? `Blendet um ${endsAt} Uhr sanft aus` : "Pause nach dem aktuellen Titel"}
        </p>
      )}

      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Sleep-Timer Dauer wählen">
        {SLEEP_TIMER_PRESETS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => setSleepTimer(minutes)}
            className="filter-chip min-h-8 justify-center px-1 font-mono text-[11px] tabular-nums"
          >
            {minutes} min
          </button>
        ))}
        <button
          type="button"
          aria-pressed={sleepAfterTrack}
          onClick={() => setSleepAfterTrack(true)}
          className="filter-chip col-span-4 min-h-8 justify-center px-2 text-xs"
        >
          Ende des aktuellen Titels
        </button>
      </div>
    </div>
  );
}

/** Single workspace-level host for the Sleep-Timer popover. */
export function SleepTimerHost() {
  const open = useUiModalsStore((s) => s.sleepTimerOpen);
  const anchor = useUiModalsStore((s) => s.sleepTimerAnchor);
  const setOpen = useUiModalsStore((s) => s.setSleepTimerOpen);
  if (!open) return null;
  return <SleepTimerPopover anchorElement={anchor} onClose={() => setOpen(false)} />;
}

function SleepTimerPopover({
  anchorElement,
  onClose,
}: {
  anchorElement: HTMLElement | null;
  onClose: () => void;
}) {
  const { sleepAt, sleepAfterTrack, armed, statusLabel, endsAt } = useSleepTimerStatus();
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const setSleepAfterTrack = usePlayerStore((s) => s.setSleepAfterTrack);
  const panelRef = useRef<HTMLDivElement>(null);

  useDialogFocus(true, panelRef, onClose);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const position = () => {
      if (window.innerWidth < 640) {
        el.style.left = "";
        el.style.top = "";
        return;
      }
      const { width, height } = el.getBoundingClientRect();
      const pad = 12;
      const rect = anchorElement && anchorElement.isConnected ? anchorElement.getBoundingClientRect() : null;
      const hasAnchor = Boolean(rect && (rect.width > 0 || rect.height > 0));
      const left = hasAnchor && rect
        ? Math.max(pad, Math.min(rect.right - width, window.innerWidth - width - pad))
        : Math.max(pad, window.innerWidth - width - pad);
      const preferredTop = hasAnchor && rect ? rect.top - height - 10 : window.innerHeight - height - 96;
      const top = preferredTop >= pad ? preferredTop : Math.max(pad, Math.min((rect?.bottom ?? pad) + 8, window.innerHeight - height - pad));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [anchorElement]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorElement?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [onClose, anchorElement]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[125] bg-black/50 sm:hidden" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Sleep-Timer"
        className="pop-in fixed inset-x-0 bottom-0 z-[130] flex flex-col gap-3 rounded-t-[var(--radius-panel)] border border-hairline bg-panel p-4 shadow-[0_24px_60px_rgb(0_0_0/0.65)] sm:inset-auto sm:w-80 sm:rounded-[var(--radius-panel)]"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-extrabold tracking-tight text-foreground">Sleep-Timer</h2>
            {(sleepAt != null || sleepAfterTrack) && (
              <p className="label-mono mt-0.5 text-[10px]">
                {sleepAt != null ? `Blendet um ${endsAt} Uhr sanft aus` : "Pause nach dem aktuellen Titel"}
              </p>
            )}
          </div>
          <button data-dialog-autofocus type="button" onClick={onClose} aria-label="Sleep-Timer schließen" className="action-icon h-9 w-9">
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <div className={`flex items-center justify-between rounded-[var(--radius-card)] border px-3.5 py-2.5 ${armed ? "border-accent/40 bg-accent/10" : "border-hairline bg-white/[0.03]"}`}>
          <span className={`font-display text-2xl font-extrabold tabular-nums tracking-tight ${armed ? "text-foreground" : "text-subtle"}`}>
            {statusLabel}
          </span>
          {armed && (
            <button
              type="button"
              onClick={() => setSleepTimer(null)}
              className="action-secondary min-h-8 px-3 text-xs"
            >
              Stoppen
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Dauer wählen">
          {SLEEP_TIMER_PRESETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => {
                setSleepTimer(minutes);
                onClose();
              }}
              className="filter-chip min-h-10 justify-center"
            >
              {minutes} Minuten
            </button>
          ))}
          <button
            type="button"
            aria-pressed={sleepAfterTrack}
            onClick={() => {
              setSleepAfterTrack(true);
              onClose();
            }}
            className="filter-chip col-span-2 min-h-10 justify-center"
          >
            Ende des aktuellen Titels
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
