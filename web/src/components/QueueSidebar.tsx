"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { usePlayerStore } from "@/store/player";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import { CloseIcon } from "@/components/icons";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import QueueList, { useUpcomingQueue } from "@/components/queue/QueueList";
import { useClearQueueWithUndo } from "@/components/queue/useClearQueueWithUndo";

const DOCK_QUERY = "(min-width: 1280px)";
function subscribeDock(listener: () => void) {
  const media = window.matchMedia(DOCK_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
const dockSnapshot = () => window.matchMedia(DOCK_QUERY).matches;
const serverDockSnapshot = () => false;

/**
 * Queue panel: docked beside the main panel from 1280px, a slide-over sheet
 * below that. It stays mounted while closed (and `inert`) so opening and
 * closing can animate.
 */
export default function QueueSidebar() {
  const open = usePlayerStore((s) => s.queueOpen);
  const setOpen = usePlayerStore((s) => s.setQueueOpen);
  const { upcoming } = useUpcomingQueue();
  const clearing = useClearQueueWithUndo();

  const router = useRouter();
  const [startingParty, setStartingParty] = useState(false);
  const docked = useSyncExternalStore(subscribeDock, dockSnapshot, serverDockSnapshot);
  const panelRef = useRef<HTMLElement>(null);
  const closeQueue = useCallback(() => setOpen(false), [setOpen]);
  useDialogFocus(open && !docked, panelRef, closeQueue);
  // Keep the first paint still, then animate user-initiated changes.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setAnimate(true), 350);
    return () => window.clearTimeout(t);
  }, []);

  const startParty = async () => {
    setStartingParty(true);
    try {
      // The party continues the host's current queue right where it is.
      const party = await api.createParty(undefined, usePlayerStore.getState().partyStartSnapshot());
      try {
        usePlayerStore.getState().adoptPartyQueue(
          party.tracks.map((entry) => entry.deezer_id),
          party.tracks.map((entry) => entry.id),
        );
      } finally {
        // The party exists either way; its page takes over the server state.
        router.push(`/party/${party.code}`);
      }
    } catch (error) {
      toast.error(`Party konnte nicht gestartet werden: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setStartingParty(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={closeQueue}
        className={`fixed inset-0 z-[65] bg-black/60 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none xl:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        ref={panelRef}
        role={docked ? "complementary" : "dialog"}
        aria-modal={!docked && open ? true : undefined}
        aria-label="Warteschlange"
        aria-hidden={!open}
        inert={!open}
        className={`fixed inset-y-0 right-0 z-[70] flex w-full max-w-sm flex-col overflow-hidden bg-backdrop shadow-[var(--shadow-pop)] sm:max-w-[360px] xl:static xl:z-auto xl:max-w-none xl:border-l xl:border-hairline xl:shadow-none ${
          animate ? "transition-[width,margin,transform,opacity] duration-200 ease-out motion-reduce:transition-none" : ""
        } ${
          open
            ? "translate-x-0 opacity-100 xl:w-[340px] xl:flex-shrink-0"
            : "pointer-events-none translate-x-full opacity-0 xl:w-0 xl:translate-x-0 xl:border-l-0"
        }`}
      >
        <div className="flex h-full w-full flex-shrink-0 flex-col xl:w-[340px]">
          <header className="flex flex-shrink-0 items-center justify-between gap-2 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] xl:pt-4">
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold tracking-[-0.03em]">Warteschlange</h2>
              <p className="label-mono mt-1" aria-live="polite">
                {upcoming.length === 0 ? "Keine weiteren Titel" : upcoming.length === 1 ? "1 Titel als Nächstes" : `${upcoming.length} Titel als Nächstes`}
              </p>
            </div>
            <button data-dialog-autofocus type="button" onClick={closeQueue} aria-label="Warteschlange schließen" className="action-icon">
              <CloseIcon width={20} height={20} />
            </button>
          </header>

          <div className="flex flex-shrink-0 items-center gap-2 px-4 pb-4">
            <button type="button" onClick={startParty} disabled={startingParty} className="action-secondary min-h-9 flex-1 px-4 text-[13px]">
              {startingParty ? "Wird gestartet…" : "Party starten"}
            </button>
            {clearing.canClear && upcoming.length > 0 && (
              <button type="button" onClick={clearing.clear} className="action-secondary min-h-9 px-4 text-[13px]">
                Leeren
              </button>
            )}
          </div>

          <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 pb-[calc(1rem+env(safe-area-inset-bottom))] [scrollbar-gutter:stable]">
            <QueueList />
          </div>

          {clearing.undo && (
            <div role="status" className="animate-in m-3 mt-0 flex flex-shrink-0 items-center justify-between gap-3 rounded-xl border border-hairline bg-panel py-2 pl-4 pr-2 text-sm">
              <span className="min-w-0 truncate">
                {clearing.clearedCount === 1 ? "1 Titel entfernt" : `${clearing.clearedCount} Titel entfernt`}
              </span>
              <button type="button" onClick={clearing.undo} className="action-secondary min-h-9 px-4 text-[13px] text-accent-soft">
                Rückgängig
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
