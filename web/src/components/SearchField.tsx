"use client";

import { useImperativeHandle, useRef, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { SearchIcon, CloseIcon } from "@/components/icons";

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
  useImperativeHandle(inputRef, () => {
    if (!localRef.current) throw new Error("Das Suchfeld wurde nicht eingebunden.");
    return localRef.current;
  });
  return (
    <form role="search" className={`flex min-h-12 min-w-0 items-center gap-3 rounded-xl border border-border bg-panel px-3 transition focus-within:border-accent/70 sm:px-4 ${className}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!localRef.current?.dataset.composing) onSubmit();
      }}>
      <SearchIcon width={19} height={19} className="shrink-0 text-muted" />
      <input {...inputProps} ref={localRef} type="search" aria-label={label} placeholder={placeholder} value={value}
        autoComplete="off" autoCorrect="off" spellCheck={false}
        onChange={(event) => onValueChange(event.target.value)}
        onCompositionStart={(event) => {
          event.currentTarget.dataset.composing = "true";
          inputProps?.onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          delete event.currentTarget.dataset.composing;
          inputProps?.onCompositionEnd?.(event);
        }}
        className={`h-12 w-full min-w-0 bg-transparent text-base text-foreground outline-none! placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none ${inputProps?.className ?? ""}`} />
      {value && <button type="button" aria-label="Suche leeren" className="action-icon min-h-11! min-w-11! shrink-0" onClick={() => {
        onClear();
        localRef.current?.focus({ preventScroll: true });
      }}><CloseIcon width={17} height={17} /></button>}
      {trailing}
    </form>
  );
}
