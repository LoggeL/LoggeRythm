"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

const openDialogs: symbol[] = [];
const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep keyboard navigation in the active overlay and restore its trigger. */
export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>, onClose?: () => void, trapTab = true) {
  const close = useEffectEvent(() => onClose?.());
  const canClose = onClose !== undefined;
  useEffect(() => {
    if (!open || !ref.current) return;
    const panel = ref.current;
    const previous = document.activeElement;
    const token = Symbol("dialog");
    openDialogs.push(token);

    const focusable = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.tabIndex >= 0 && element.getClientRects().length > 0,
      );
    (panel.querySelector<HTMLElement>("[data-dialog-autofocus]") ?? focusable()[0] ?? panel).focus();

    function onKey(event: KeyboardEvent) {
      if (openDialogs.at(-1) !== token) return;
      if (event.key === "Escape" && canClose) {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab" || !trapTab) return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const wasActive = openDialogs.at(-1) === token;
      openDialogs.splice(openDialogs.indexOf(token), 1);
      if (wasActive && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, [open, ref, canClose, trapTab]);
}
