"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useParty } from "@/hooks/useParty";
import { usePlayerStore } from "@/store/player";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import { formatTime } from "@/lib/format";
import { PlayIcon } from "@/components/icons";
import type { Track } from "@/types";

export default function PartyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const router = useRouter();
  const { party, isLoading, isError, join, add, remove, reorder, setCurrent, leave } =
    useParty(code);
  const playerIndex = usePlayerStore((s) => s.index);

  const [copied, setCopied] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);

  // Join on mount.
  useEffect(() => {
    if (!code) return;
    join().catch(() => toast.error("Beitritt zur Party fehlgeschlagen."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/party/${code}`
      : `/party/${code}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Link konnte nicht kopiert werden.");
    }
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setSearching(true);
    try {
      const tracks = await api.search(term, "track");
      setResults(tracks);
    } catch {
      toast.error("Suche fehlgeschlagen.");
    } finally {
      setSearching(false);
    }
  };

  const onLeave = async () => {
    try {
      await leave();
    } finally {
      router.push("/");
    }
  };

  if (isLoading && !party) {
    return <p className="text-muted animate-in">Party wird geladen…</p>;
  }
  if (isError || !party) {
    return <p className="text-red-400 animate-in">Party nicht gefunden.</p>;
  }

  const tracks = party.tracks;

  return (
    <div className="animate-in max-w-3xl">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted">Party Mode</p>
        <h1 className="text-3xl font-extrabold mb-1">{party.name || "Party"}</h1>
        <p className="text-sm text-muted">Code: {party.code}</p>
      </header>

      <section className="mb-6 bg-panel rounded-lg p-4">
        <p className="text-xs uppercase tracking-wide text-muted mb-2">
          Teilen
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={shareUrl}
            className="flex-1 min-w-0 bg-panel-hover rounded px-3 py-2 text-sm text-foreground"
          />
          <button
            type="button"
            onClick={copyLink}
            className="px-4 py-2 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent-hover press"
          >
            {copied ? "Kopiert!" : "Kopieren"}
          </button>
        </div>
      </section>

      <section className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted mb-2">
          Mitglieder ({party.members.length})
        </p>
        <div className="flex flex-wrap gap-2">
          {party.members.map((m) => (
            <span
              key={m}
              className="px-3 py-1 rounded-full bg-panel text-sm text-foreground"
            >
              {m}
            </span>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <p className="text-xs uppercase tracking-wide text-muted mb-2">
          Songs hinzufügen
        </p>
        <form onSubmit={runSearch} className="flex items-center gap-2 mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nach Titeln suchen…"
            className="flex-1 min-w-0 bg-panel rounded px-3 py-2 text-sm text-foreground placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={searching}
            className="px-4 py-2 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-40 press"
          >
            Suchen
          </button>
        </form>
        {results.length > 0 && (
          <ul className="flex flex-col gap-1">
            {results.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-panel-hover"
              >
                {t.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.cover}
                    alt=""
                    className="w-10 h-10 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-panel-hover flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{t.title}</div>
                  <div className="truncate text-xs text-muted">{t.artist}</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    add(t).then(() => toast.success("Zur Party hinzugefügt."))
                  }
                  className="px-3 py-1 rounded-full bg-panel-hover text-sm hover:bg-accent hover:text-white press flex-shrink-0"
                >
                  + Hinzufügen
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <p className="text-xs uppercase tracking-wide text-muted mb-2">
          Warteschlange ({tracks.length})
        </p>
        {tracks.length === 0 ? (
          <p className="text-sm text-muted">Noch keine Songs in der Party.</p>
        ) : (
          <ul className="flex flex-col">
            {tracks.map((t, i) => {
              const isCurrent = i === playerIndex;
              const ids = tracks.map((x) => x.id);
              return (
                <li
                  key={t.id}
                  className={`group flex items-center gap-2 px-2 py-2 rounded-md transition hover:bg-panel-hover ${
                    isCurrent ? "bg-panel-hover" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setCurrent(i)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    {t.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.cover}
                        alt=""
                        className="w-10 h-10 rounded object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-panel-hover flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div
                        className={`truncate text-sm ${
                          isCurrent ? "text-accent font-medium" : ""
                        }`}
                      >
                        {t.title}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {t.artist} · von {t.added_by}
                      </div>
                    </div>
                  </button>

                  {isCurrent && (
                    <span className="text-accent flex-shrink-0" aria-hidden="true">
                      <PlayIcon />
                    </span>
                  )}

                  <span className="text-xs text-muted tabular-nums">
                    {formatTime(t.duration_sec)}
                  </span>

                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition">
                    <button
                      type="button"
                      onClick={() => reorder(swap(ids, i, i - 1))}
                      disabled={i === 0}
                      aria-label="Nach oben"
                      className="text-muted hover:text-foreground px-1 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => reorder(swap(ids, i, i + 1))}
                      disabled={i === tracks.length - 1}
                      aria-label="Nach unten"
                      className="text-muted hover:text-foreground px-1 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(t.id)}
                      aria-label="Entfernen"
                      className="text-muted hover:text-foreground px-1"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={onLeave}
        className="px-5 py-2 rounded-full bg-panel hover:bg-panel-hover text-foreground text-sm font-semibold press"
      >
        Party verlassen
      </button>
    </div>
  );
}

// Move the id at `from` to position `to`, returning the new id ordering.
function swap(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
