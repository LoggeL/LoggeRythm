"use client";

import { useEffect, useEffectEvent, useImperativeHandle, useRef, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { SearchIcon, CloseIcon } from "@/components/icons";

function ignoreControlledChange() {}

export type SearchFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  label?: string;
  placeholder?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">;
  trailing?: ReactNode;
};

export default function SearchField({ value, onValueChange, onSubmit, onClear, label = "Musik suchen", placeholder = "Musik suchen", className = "", inputRef, inputProps, trailing }: SearchFieldProps) {
  const localRef = useRef<HTMLInputElement>(null);
  const onNativeInput = useEffectEvent((nextValue: string) => onValueChange(nextValue));
  // Listen on native `input` capture strictly scoped to this input element:
  // React 19 disables its synthetic event system (`_enabled = false`) while a
  // `<ViewTransition>` snapshot is pending (e.g. during Next.js URL updates),
  // which otherwise drops both `onChange` and synthetic `onInput` keystrokes.
  useEffect(() => {
    function captureInput(event: Event) {
      const input = localRef.current;
      if (input && event.target === input) onNativeInput(input.value);
    }
    window.addEventListener("input", captureInput, true);
    return () => window.removeEventListener("input", captureInput, true);
  }, []);
  useImperativeHandle(inputRef, () => {
    if (!localRef.current) throw new Error("Das Suchfeld wurde nicht eingebunden.");
    return localRef.current;
  });
  return (
    <form role="search" className={`flex min-h-11 min-w-0 items-center gap-3 rounded-[var(--radius-control)] border border-hairline bg-foreground/[0.05] px-4 transition hover:border-foreground/20 focus-within:border-foreground focus-within:bg-foreground/[0.08] ${className}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!localRef.current?.dataset.composing) onSubmit();
      }}>
      <SearchIcon width={19} height={19} className="shrink-0 text-muted" />
      <input {...inputProps} ref={localRef} type="search" aria-label={label} placeholder={placeholder} value={value}
        autoComplete="off" autoCorrect="off" spellCheck={false}
        onChange={ignoreControlledChange}
        onCompositionStart={(event) => {
          event.currentTarget.dataset.composing = "true";
          inputProps?.onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          delete event.currentTarget.dataset.composing;
          inputProps?.onCompositionEnd?.(event);
        }}
        className={`h-11 w-full min-w-0 bg-transparent text-[15px] text-foreground outline-none! placeholder:text-subtle [&::-webkit-search-cancel-button]:appearance-none ${inputProps?.className ?? ""}`} />
      {value && <button type="button" aria-label="Suche leeren" className="action-icon -mr-2 h-9 min-h-0 w-9 shrink-0" onClick={() => {
        onClear();
        localRef.current?.focus({ preventScroll: true });
      }}><CloseIcon width={17} height={17} /></button>}
      {trailing}
    </form>
  );
}
