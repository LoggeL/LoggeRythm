"use client";

import QueueList, { useUpcomingQueue } from "@/components/queue/QueueList";
import { useClearQueueWithUndo } from "@/components/queue/useClearQueueWithUndo";

/**
 * Queue panel of the fullscreen player. Same editable list as the queue
 * panel in the main shell.
 */
export default function QueuePanel({ onClose }: { onClose: () => void }) {
  const { upcoming } = useUpcomingQueue();
  const clearing = useClearQueueWithUndo();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 flex-shrink-0 items-center justify-between gap-3 pb-2">
        <h2 className="label-mono">{upcoming.length === 1 ? "1 Titel folgt" : `${upcoming.length} Titel folgen`}</h2>
        {clearing.undo ? (
          <button type="button" onClick={clearing.undo} className="action-secondary min-h-9 px-4 text-xs text-accent-soft">
            Leeren rückgängig
          </button>
        ) : (
          clearing.canClear &&
          upcoming.length > 0 && (
            <button type="button" onClick={clearing.clear} className="action-secondary min-h-9 px-4 text-xs">
              Leeren
            </button>
          )
        )}
      </div>
      <div data-np-scroll className="scroll-area -mx-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <QueueList onNavigate={onClose} />
      </div>
    </div>
  );
}
