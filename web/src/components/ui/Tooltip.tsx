"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

function TooltipPortal({
  id,
  anchorRef,
  label,
  detail,
  onClose,
}: {
  id: string;
  anchorRef: RefObject<HTMLSpanElement | null>;
  label: string;
  detail?: string;
  onClose: () => void;
}) {
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const tip = tooltipRef.current;
    if (!anchor || !tip) return;

    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const pad = 10;
      const left = Math.max(
        pad,
        Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - pad),
      );
      const aboveTop = rect.top - height - 8;
      const top =
        aboveTop >= pad
          ? aboveTop
          : Math.min(rect.bottom + 8, window.innerHeight - height - pad);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };

    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [anchorRef, label, detail]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const closeOnScroll = () => onClose();
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <span
      ref={tooltipRef}
      id={id}
      role="tooltip"
      className="pop-in pointer-events-none fixed left-0 top-0 z-[140] max-w-[16rem] rounded-[var(--radius-control)] border border-white/15 bg-[#0f0e11]/95 px-2.5 py-1.5 text-left shadow-[0_12px_32px_rgb(0_0_0/0.65)] backdrop-blur-md"
    >
      <span className="block text-[11.5px] font-semibold leading-snug text-foreground">
        {label}
      </span>
      {detail && (
        <span className="mt-0.5 block text-[10.5px] leading-snug text-muted">
          {detail}
        </span>
      )}
    </span>,
    document.body,
  );
}

/**
 * Hover/focus tooltip portaled to `document.body` so compact indicators inside
 * `overflow-hidden` or `truncate` rows never clip.
 */
export default function Tooltip({
  label,
  detail,
  children,
  className = "",
}: {
  label: string;
  detail?: string;
  children: ReactNode;
  className?: string;
}) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const pointerDownRef = useRef(false);
  const [open, setOpen] = useState(false);

  return (
    <span
      ref={triggerRef}
      data-tooltip={label}
      aria-describedby={open ? tooltipId : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setOpen(true);
      }}
      onPointerLeave={() => {
        pointerDownRef.current = false;
        setOpen(false);
      }}
      onPointerDown={() => {
        pointerDownRef.current = true;
        setOpen(false);
      }}
      onPointerUp={() => {
        pointerDownRef.current = false;
      }}
      onFocus={() => {
        if (!pointerDownRef.current) setOpen(true);
      }}
      onBlur={() => {
        pointerDownRef.current = false;
        setOpen(false);
      }}
      className={`inline-flex shrink-0 items-center ${className}`}
    >
      {children}
      {open && (
        <TooltipPortal
          id={tooltipId}
          anchorRef={triggerRef}
          label={label}
          detail={detail}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}
