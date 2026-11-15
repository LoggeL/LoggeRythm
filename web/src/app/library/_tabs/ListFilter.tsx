"use client";

import { SearchIcon } from "@/components/icons";

/** Compact "filter this list" field. `label` is both placeholder and accessible name. */
export default function ListFilter({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <label className={`relative block min-w-0 ${className}`}>
      <SearchIcon aria-hidden="true" width={15} height={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="field-input rounded-full py-2 pl-10 pr-4 text-sm sm:min-h-10"
      />
    </label>
  );
}

/** Shown instead of the list when the filter excludes every entry. */
export function NoFilterMatch({ term, onReset }: { term: string; onReset: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 py-6 text-sm text-muted">
      <span>Nichts passt zu „{term.trim()}“.</span>
      <button type="button" className="action-secondary min-h-9 px-4 text-xs" onClick={onReset}>
        Filter zurücksetzen
      </button>
    </div>
  );
}
