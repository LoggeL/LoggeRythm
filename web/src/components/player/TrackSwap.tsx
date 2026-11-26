"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  initialTrackSwapState,
  nextTrackSwapState,
  settleTrackSwap,
  settleTrackSwapArrival,
  trackSwapStyle,
  type TrackSwapSlot,
} from "@/lib/trackSwap";

/**
 * Renders `children(item)` and animates track changes (see `lib/trackSwap.ts`):
 * the new copy slides in over the previous one, which morphs out underneath
 * once the new one has landed. Mark the cover with `data-swap-part="art"` and
 * the title block with `data-swap-part="text"` inside `children`: text is
 * sequenced (old out, then new in) because two titles cannot overlap legibly.
 * The previous copy is inert and hidden from assistive tech, so only the real
 * current track can be read or clicked. The current copy is never remounted,
 * so focus inside it (a link, a button) survives a track change.
 */
export default function TrackSwap<T>({
  slot,
  item,
  className = "",
  children,
}: {
  slot: TrackSwapSlot | null;
  item: T;
  className?: string;
  children: (item: T) => ReactNode;
}) {
  const [state, setState] = useState(() => initialTrackSwapState(slot, item));
  const next = nextTrackSwapState(state, slot, item);
  if (next !== state) setState(next);

  const rootRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const ghost = next.ghost;
  const ghostId = ghost?.id ?? null;
  const sequence = next.sequence;

  // Ended or cancelled (e.g. the copy got hidden mid-way): either way it is over.
  // Covers inside run their own load animation and bubble up here; only ours count.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) throw new Error("TrackSwap: root element is not mounted");
    const finish = (event: Event) => {
      const target = event.target;
      if (target === ghostRef.current) {
        const id = Number((target as HTMLElement).dataset.ghost);
        setState((current) => settleTrackSwap(current, id));
      } else if (target === laneRef.current) {
        const lane = target as HTMLElement;
        // A quick second change swaps the keyframe set, which cancels the first
        // arrival while the second already runs (Firefox and Safari report it):
        // that cancel is not this arrival's end.
        if (event.type === "animationcancel" && lane.getAnimations().length > 0) return;
        const landed = Number(lane.dataset.sequence);
        setState((current) => settleTrackSwapArrival(current, landed));
      }
    };
    root.addEventListener("animationend", finish);
    root.addEventListener("animationcancel", finish);
    return () => {
      root.removeEventListener("animationend", finish);
      root.removeEventListener("animationcancel", finish);
    };
  }, []);

  // A copy that is not rendered (the mobile mini player on desktop and vice
  // versa) runs no animation, so no end event would ever come: settle at once.
  useLayoutEffect(() => {
    const ghostElement = ghostRef.current;
    if (ghostId !== null && ghostElement !== null && ghostElement.getAnimations().length === 0) {
      setState((current) => settleTrackSwap(current, ghostId));
    }
    const lane = laneRef.current;
    if (lane === null) throw new Error("TrackSwap: lane element is not mounted");
    if (lane.dataset.swap !== undefined && lane.getAnimations().length === 0) {
      setState((current) => settleTrackSwapArrival(current, sequence));
    }
  }, [ghostId, sequence]);

  return (
    <div ref={rootRef} className={`track-swap ${className}`}>
      {ghost && (
        <div
          key={`ghost-${ghost.id}`}
          ref={ghostRef}
          className="track-swap-ghost"
          data-ghost={ghost.id}
          style={trackSwapStyle(ghost.change) as CSSProperties}
          aria-hidden
          inert
        >
          {children(ghost.item)}
        </div>
      )}
      <div
        ref={laneRef}
        className="track-swap-lane"
        data-swap={next.arrival ?? undefined}
        data-swap-phase={next.arrival ? sequence % 2 : undefined}
        data-sequence={sequence}
        style={next.arrival ? (trackSwapStyle(next.arrival) as CSSProperties) : undefined}
      >
        {children(item)}
      </div>
    </div>
  );
}
