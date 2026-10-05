"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

const MENU_WIDTH = 224; // w-56
const VIEWPORT_PADDING = 8;

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Clamp to viewport once the menu has measured its real size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + width > window.innerWidth - VIEWPORT_PADDING) {
      left = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
    }
    if (top + height > window.innerHeight - VIEWPORT_PADDING) {
      top = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);
    }
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
    if (top < VIEWPORT_PADDING) top = VIEWPORT_PADDING;
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const panel = ref.current;
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onCtx(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Tab") {
        if (e.key === "Escape") e.preventDefault();
        onClose();
        return;
      }
      const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []);
      if (!buttons.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (current + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
    function onScroll(event: Event) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("contextmenu", onCtx);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("contextmenu", onCtx);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
      if (previous instanceof HTMLElement && previous.isConnected && (panel?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus();
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
      className="pop-in fixed z-[100] max-h-[80dvh] overflow-y-auto rounded-md bg-[#282828] border border-white/10 shadow-xl py-1 text-sm"
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            it.onClick();
          }}
          className={`w-full text-left px-3 py-2 flex items-center gap-2.5 truncate transition hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none ${
            it.danger ? "text-red-400" : "text-foreground"
          }`}
        >
          {it.icon && (
            <span className="flex-shrink-0 flex items-center justify-center w-4 h-4">
              {it.icon}
            </span>
          )}
          <span className="truncate">{it.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
