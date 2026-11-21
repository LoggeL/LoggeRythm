"use client";

import type { PartyListenMode } from "../listenMode";

const OPTIONS: { mode: PartyListenMode; label: string }[] = [
  { mode: "device", label: "Auf diesem Gerät" },
  { mode: "host", label: "Beim Host" },
];

/**
 * A member picks where they hear the party: in step in this browser, or
 * together at the host's speaker with this browser silent.
 */
export default function ListenChoice({
  hostName,
  mode,
  onChange,
}: {
  hostName: string;
  mode: PartyListenMode;
  onChange: (mode: PartyListenMode) => void;
}) {
  return (
    <section aria-labelledby="party-listen-title" className="mb-8 border-l-2 border-border py-0.5 pl-4">
      <h2 id="party-listen-title" className="text-sm font-semibold text-foreground">
        Wo hörst du?
      </h2>
      <div role="radiogroup" aria-labelledby="party-listen-title" className="mt-3 flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={mode === option.mode}
            data-active={mode === option.mode}
            onClick={() => onChange(option.mode)}
            className="filter-chip"
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {mode === "device" ? (
          <>
            <span className="font-medium text-foreground">{hostName} steuert die Wiedergabe.</span> Deine Wiedergabe folgt
            automatisch – Songs kannst du jederzeit zur Warteschlange hinzufügen.
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">Ihr hört gemeinsam bei {hostName}.</span> Dieser Browser spielt
            nichts ab – Songs kannst du trotzdem hinzufügen.
          </>
        )}
      </p>
    </section>
  );
}
