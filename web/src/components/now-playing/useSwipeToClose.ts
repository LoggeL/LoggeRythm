"use client";

import { useRef, type RefObject, type TouchEvent } from "react";

/** Drag distance (px) past which releasing the vertical swipe closes the sheet. */
const CLOSE_DISTANCE = 110;
/** Horizontal drag distance (px) on the artwork stage to skip prev/next track. */
const SKIP_DISTANCE = 72;

export interface SwipeOptions {
  artworkRef?: RefObject<HTMLDivElement | null>;
  onSwipeNext?: () => void;
  onSwipePrev?: () => void;
}

/**
 * Touch gestures for the fullscreen sheet:
 * - Vertical swipe down closes the sheet (excluding range inputs and scrolled lists).
 * - Horizontal swipe on `[data-np-swipe-track]` artwork skips next/prev track
 *   with live spring-peek feedback.
 */
export function useSwipeToClose(
  ref: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  options: SwipeOptions = {},
) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const axis = useRef<"vertical" | "horizontal" | null>(null);
  const canHorizontal = useRef(false);
  const dxRef = useRef(0);
  const dyRef = useRef(0);

  const resetSheet = (el: HTMLDivElement, animate: boolean) => {
    el.style.transition = animate ? "transform 0.2s ease, opacity 0.2s ease" : "";
    el.style.transform = "";
    el.style.opacity = "";
  };

  const resetArtwork = (animate: boolean) => {
    const art = options.artworkRef?.current;
    if (!art) return;
    art.style.transition = animate ? "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease" : "";
    art.style.transform = "";
    art.style.opacity = "";
  };

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest("input")) return;
    const scroller = target.closest("[data-np-scroll]");
    if (scroller && scroller.scrollTop > 0) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    axis.current = null;
    canHorizontal.current = Boolean(
      target.closest("[data-np-swipe-track]") && (options.onSwipeNext || options.onSwipePrev),
    );
    dxRef.current = 0;
    dyRef.current = 0;
  };

  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (startX.current == null || startY.current == null) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    dxRef.current = dx;
    dyRef.current = dy;

    if (axis.current === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      axis.current = canHorizontal.current && Math.abs(dx) > Math.abs(dy) * 1.15 ? "horizontal" : "vertical";
    }

    if (axis.current === "horizontal") {
      const art = options.artworkRef?.current;
      if (!art) return;
      const clamped = Math.max(-140, Math.min(140, dx));
      art.style.transition = "none";
      art.style.transform = `translateX(${clamped}px) scale(${1 - Math.min(0.06, Math.abs(clamped) / 1800)})`;
      art.style.opacity = String(Math.max(0.55, 1 - Math.abs(clamped) / 360));
      return;
    }

    const el = ref.current;
    if (!el) return;
    if (dy > 0) {
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      el.style.opacity = String(Math.max(0.5, 1 - dy / 600));
    } else {
      resetSheet(el, false);
    }
  };

  const onTouchEnd = () => {
    if (startX.current == null || startY.current == null) return;
    const currentAxis = axis.current;
    const dx = dxRef.current;
    const dy = dyRef.current;
    startX.current = null;
    startY.current = null;
    axis.current = null;
    canHorizontal.current = false;
    dxRef.current = 0;
    dyRef.current = 0;

    if (currentAxis === "horizontal") {
      resetArtwork(true);
      if (dx <= -SKIP_DISTANCE) options.onSwipeNext?.();
      else if (dx >= SKIP_DISTANCE) options.onSwipePrev?.();
      return;
    }

    const el = ref.current;
    if (!el) return;
    if (dy > CLOSE_DISTANCE) {
      resetSheet(el, false);
      onClose();
    } else {
      resetSheet(el, true);
    }
  };

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd };
}
