"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Track } from "@/types";
import TrackRow from "@/components/TrackRow";
import { GripIcon } from "@/components/icons";
import trackStyles from "@/components/trackList.module.css";

/** `from`: index being dragged. `slot`: gap it would drop into (0…length). */
interface Drag {
  from: number;
  slot: number;
}

const SCROLL_EDGE = 72; // px from the viewport edge where auto-scroll starts
const SCROLL_TOP_CHROME = 100; // top bar + sticky column header
const SCROLL_STEP = 14;
const FOCUS_RESTORE_WINDOW_MS = 2000;

/** Index a dragged row lands on when dropped into `slot`. */
function landingIndex({ from, slot }: Drag): number {
  return slot > from ? slot - 1 : slot;
}

function scrollParent(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return document.documentElement;
}

/**
 * Track rows of a collection. With `onReorder` every row gets a grip that
 * reorders by drag-and-drop (mouse, pen and touch), by ↑/↓ on the focused
 * grip, and through "Nach oben/unten verschieben" in the row's menu. The move
 * is reported once, on drop; the caller applies it and reports failures.
 */
export default function SortableTracks({
  tracks,
  onPlay,
  onRemove,
  onReorder,
  showAlbum = true,
}: {
  tracks: Track[];
  onPlay: (index: number) => void;
  onRemove?: (track: Track) => void;
  /** Move the track at index `from` so that it ends up at index `to`. */
  onReorder?: (from: number, to: number) => void;
  showAlbum?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const pointerY = useRef(0);
  const pendingFocus = useRef<{ id: string; index: number; at: number } | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const hintId = useId();

  function setDrag(next: Drag | null) {
    const current = dragRef.current;
    if (current?.from === next?.from && current?.slot === next?.slot) return;
    dragRef.current = next;
    setDragState(next);
  }

  function slotAt(clientY: number): number {
    const list = listRef.current;
    if (!list) throw new Error("Die Titelliste ist nicht eingebunden; Sortieren ist nicht möglich.");
    const rows = list.querySelectorAll<HTMLElement>("[data-sort-row]");
    for (let index = 0; index < rows.length; index++) {
      const rect = rows[index].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return rows.length;
  }

  function move(from: number, to: number) {
    if (!onReorder || to === from || to < 0 || to >= tracks.length) return;
    onReorder(from, to);
    setAnnouncement(`„${tracks[from].title}“ ist jetzt an Position ${to + 1} von ${tracks.length}.`);
  }

  // While dragging: scroll the page when the pointer nears its edges, and let
  // Escape abort the drag.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const list = listRef.current;
    if (!list) throw new Error("Die Titelliste ist nicht eingebunden; Sortieren ist nicht möglich.");
    const scroller = scrollParent(list);
    let frame = requestAnimationFrame(function tick() {
      const rect = scroller.getBoundingClientRect();
      const y = pointerY.current;
      const before = scroller.scrollTop;
      if (y < rect.top + SCROLL_TOP_CHROME + SCROLL_EDGE) scroller.scrollTop -= SCROLL_STEP;
      else if (y > rect.bottom - SCROLL_EDGE) scroller.scrollTop += SCROLL_STEP;
      const active = dragRef.current;
      if (active && scroller.scrollTop !== before) setDrag({ from: active.from, slot: slotAt(y) });
      frame = requestAnimationFrame(tick);
    });
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDrag(null);
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [dragging]);

  // Reordering re-inserts the moved row's DOM node, which drops keyboard
  // focus. Put it back on the grip once the row has reached its new place.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (performance.now() - pending.at > FOCUS_RESTORE_WINDOW_MS) {
      pendingFocus.current = null;
      return;
    }
    if (String(tracks[pending.index]?.id) !== pending.id) return;
    pendingFocus.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(pending.id)}"] [data-drag-handle]`)?.focus();
  }, [tracks]);

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (event.button !== 0) return;
    event.preventDefault(); // no text selection or native drag while sorting
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerY.current = event.clientY;
    setDrag({ from: index, slot: index });
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const active = dragRef.current;
    if (!active) return;
    pointerY.current = event.clientY;
    setDrag({ from: active.from, slot: slotAt(event.clientY) });
  }

  function handlePointerUp() {
    const active = dragRef.current;
    if (!active) return;
    setDrag(null);
    move(active.from, landingIndex(active));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const to = index + (event.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= tracks.length) return;
    pendingFocus.current = { id: String(tracks[index].id), index: to, at: performance.now() };
    move(index, to);
  }

  const dropIndex = drag ? landingIndex(drag) : -1;
  const showsDrop = drag !== null && dropIndex !== drag.from;

  return (
    <div ref={listRef} className="flex flex-col" data-sorting={dragging || undefined}>
      {onReorder && (
        <>
          <p id={hintId} hidden>
            Ziehen oder mit den Pfeiltasten nach oben und unten verschieben.
          </p>
          <p role="status" className="sr-only">
            {announcement}
          </p>
        </>
      )}
      {tracks.map((track, index) => (
        <div key={track.id} data-sort-row className={`relative ${drag?.from === index ? "opacity-40" : ""}`}>
          {showsDrop && drag.slot === index && <DropLine edge="top" />}
          {showsDrop && drag.slot === tracks.length && index === tracks.length - 1 && <DropLine edge="bottom" />}
          <TrackRow
            track={track}
            index={index}
            showAlbum={showAlbum}
            onPlay={() => onPlay(index)}
            onRemove={onRemove ? () => onRemove(track) : undefined}
            onMoveUp={onReorder && index > 0 ? () => move(index, index - 1) : undefined}
            onMoveDown={onReorder && index < tracks.length - 1 ? () => move(index, index + 1) : undefined}
            dragHandle={
              onReorder ? (
                <button
                  type="button"
                  data-drag-handle
                  aria-label={`„${track.title}“ verschieben`}
                  aria-describedby={hintId}
                  title="Ziehen zum Sortieren (oder ↑ ↓)"
                  className={trackStyles.handle}
                  onPointerDown={(event) => handlePointerDown(event, index)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={() => setDrag(null)}
                  onLostPointerCapture={() => setDrag(null)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  <GripIcon aria-hidden="true" />
                </button>
              ) : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}

function DropLine({ edge }: { edge: "top" | "bottom" }) {
  return <span aria-hidden="true" className={`pointer-events-none absolute inset-x-2 z-[3] h-0.5 rounded-full bg-accent ${edge === "top" ? "-top-px" : "-bottom-px"}`} />;
}
