"use client";

import { useRef, type RefObject, type TouchEvent } from "react";

/** Drag distance (px) past which releasing the swipe closes the sheet. */
const CLOSE_DISTANCE = 110;

/**
 * Swipe-down-to-close for the fullscreen sheet (touch only). The sheet follows
 * the finger for direct feedback; releasing past {@link CLOSE_DISTANCE} closes,
 * anything less springs back. Standard sheet semantics for scrollable regions
 * (`[data-np-scroll]`): the gesture only engages there while the scroller is
 * at its top, so mid-list scrolling keeps working. Range inputs are always
 * excluded so seeking never closes the sheet.
 */
export function useSwipeToClose(
  ref: RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  const startY = useRef<number | null>(null);
  const delta = useRef(0);

  const reset = (el: HTMLDivElement, animate: boolean) => {
    el.style.transition = animate ? "transform 0.2s ease, opacity 0.2s ease" : "";
    el.style.transform = "";
    el.style.opacity = "";
  };

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest("input")) return;
    const scroller = target.closest("[data-np-scroll]");
    if (scroller && scroller.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    delta.current = 0;
  };

  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (startY.current == null) return;
    const el = ref.current;
    if (!el) return;
    const dy = e.touches[0].clientY - startY.current;
    delta.current = dy;
    if (dy > 0) {
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      el.style.opacity = String(Math.max(0.5, 1 - dy / 600));
    } else {
      reset(el, false);
    }
  };

  const onTouchEnd = () => {
    if (startY.current == null) return;
    const dy = delta.current;
    startY.current = null;
    delta.current = 0;
    const el = ref.current;
    if (!el) return;
    if (dy > CLOSE_DISTANCE) {
      // Clear inline styles first: the component may stay mounted if the
      // fullscreen is reopened before React unmounts it.
      reset(el, false);
      onClose();
    } else {
      reset(el, true);
    }
  };

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd };
}
