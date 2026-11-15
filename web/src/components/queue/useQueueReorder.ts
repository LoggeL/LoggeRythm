"use client";

import { useState, type DragEvent, type KeyboardEvent } from "react";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";

/** Where the dragged row will land relative to the row under the pointer. */
export type DropEdge = "before" | "after";

export interface QueueRowDragProps {
  draggable: true;
  onDragStart: (event: DragEvent<HTMLLIElement>) => void;
  onDragOver: (event: DragEvent<HTMLLIElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => void;
}

/**
 * Drag-and-drop and keyboard reordering for the upcoming queue. The manual
 * section and the context section are separate lists, so a row can only move
 * among rows of its own origin and never above the playing track.
 */
export function useQueueReorder() {
  const origins = usePlayerStore((s) => s.origins);
  const index = usePlayerStore((s) => s.index);
  const length = usePlayerStore((s) => s.queue.length);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const canMove = (from: number, to: number) => to > index && to < length && origins[to] === origins[from];
  const stop = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  /** Move a row by one position; returns the new index, or null if blocked. */
  const moveBy = (from: number, delta: -1 | 1): number | null => {
    const to = from + delta;
    if (!canMove(from, to)) return null;
    reorderQueue(from, to);
    return to;
  };

  const dropEdge = (i: number): DropEdge | null => {
    if (dragIndex === null || overIndex !== i || dragIndex === i) return null;
    return dragIndex < i ? "after" : "before";
  };

  const rowProps = (i: number): QueueRowDragProps => ({
    draggable: true,
    onDragStart: (event) => {
      setDragIndex(i);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(i));
    },
    onDragOver: (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (overIndex !== i) setOverIndex(i);
    },
    onDragLeave: () => {
      if (overIndex === i) setOverIndex(null);
    },
    onDrop: (event) => {
      event.preventDefault();
      if (dragIndex !== null && dragIndex !== i) {
        if (origins[dragIndex] !== origins[i]) {
          toast.error("Titel können nicht zwischen deinen nächsten Titeln und der Playlist-Reihenfolge verschoben werden.");
        } else {
          reorderQueue(dragIndex, i);
        }
      }
      stop();
    },
    onDragEnd: stop,
    onKeyDown: (event) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      event.stopPropagation();
      const list = event.currentTarget.closest("[data-queue-list]");
      const target = moveBy(i, event.key === "ArrowUp" ? -1 : 1);
      // The moved row re-renders at its new index; keep the keyboard focus on it.
      if (target !== null) window.requestAnimationFrame(() => list?.querySelector<HTMLElement>(`[data-queue-index="${target}"]`)?.focus());
    },
  });

  return { dragIndex, dropEdge, canMove, moveBy, rowProps };
}
