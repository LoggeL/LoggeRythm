"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/hooks/useDialogFocus";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a divider above this item to set a group apart. */
  separated?: boolean;
  /** Render the item as a link (e.g. a file download) instead of a button. */
  href?: string;
  download?: boolean;
}

const MENU_WIDTH = 264;
const VIEWPORT_PADDING = 8;
const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

/**
 * Floating menu anchored at a viewport point. Arrow keys / Home / End move
 * between items, Escape, Tab, outside clicks, scrolling and resizing close it,
 * and focus returns to whatever opened it.
 */
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
  useDialogFocus(true, ref, onClose, false);

  // Clamp to viewport once the menu has measured its real size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_PADDING;
    const maxTop = window.innerHeight - height - VIEWPORT_PADDING;
    setPos({
      left: Math.max(VIEWPORT_PADDING, Math.min(x, maxLeft)),
      top: Math.max(VIEWPORT_PADDING, Math.min(y, maxTop)),
    });
  }, [x, y]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (e.key === "Tab") {
        onClose();
        return;
      }
      const entries = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
      if (!entries.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const current = entries.indexOf(document.activeElement as HTMLElement);
      const last = entries.length - 1;
      const next = e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "ArrowDown" ? (current + 1) % entries.length : current <= 0 ? last : current - 1;
      entries[next].focus();
    }
    function onScroll(event: Event) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("contextmenu", onOutside);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("contextmenu", onOutside);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const hasIcons = items.some((it) => it.icon);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
      className="pop-in scroll-area fixed z-[130] max-h-[80dvh] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[var(--radius-panel)] border border-hairline bg-panel p-1.5 text-sm shadow-[0_18px_44px_rgb(0_0_0/0.55)]"
    >
      {items.map((it) => {
        const className = `relative flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-medium transition-colors before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[2px] before:-translate-y-1/2 before:rounded-full before:opacity-0 focus-visible:outline-none focus-visible:before:opacity-100 disabled:text-subtle disabled:hover:bg-transparent [@media(pointer:coarse)]:min-h-11 ${
          it.danger
            ? "text-danger before:bg-danger hover:bg-danger/10 focus-visible:bg-danger/10"
            : "text-foreground before:bg-accent hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07]"
        }`;
        const content = (
          <>
            {hasIcons && (
              <span aria-hidden="true" className={`grid h-[18px] w-[18px] shrink-0 place-items-center ${it.danger ? "" : "text-muted"}`}>
                {it.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
          </>
        );
        const activate = () => {
          onClose();
          it.onClick();
        };
        return (
          <div key={it.label} role="none" className={it.separated ? "mt-1.5 border-t border-hairline pt-1.5" : undefined}>
            {it.href && !it.disabled ? (
              <a role="menuitem" href={it.href} download={it.download} onClick={activate} className={className}>
                {content}
              </a>
            ) : (
              <button type="button" role="menuitem" disabled={it.disabled} onClick={activate} className={className}>
                {content}
              </button>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
