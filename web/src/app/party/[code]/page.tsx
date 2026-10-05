"use client";

import { use, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useParty } from "@/hooks/useParty";
import { usePlayerStore } from "@/store/player";
import { usePartyStore } from "@/store/party";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import { formatTime } from "@/lib/format";
import { trackArtistLabel } from "@/lib/trackArtists";
import { PlayIcon } from "@/components/icons";
import Avatar from "@/components/Avatar";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import type { Track } from "@/types";
import {
  createPartySearchRequests,
  leavePartyAndNavigate,
  partyFailureMessage,
} from "../requests";

export default function PartyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const router = useRouter();
  const {
    party,
    isLoading,
    isError,
    error,
    refetch,
    join,
    add,
    remove,
    reorder,
    setCurrent,
    setPlayback,
    leave,
  } = useParty(code);
  const followHostPlayback = usePlayerStore((s) => s.followHostPlayback);

  const isHost = !!party?.is_host;
  // Host-authoritative playback mirrored from the SSE stream.
  const hostIsPlaying = usePartyStore((s) => s.isPlaying);
  const hostPosition = usePartyStore((s) => s.positionSec);
  const hostUpdatedAt = usePartyStore((s) => s.playbackUpdatedAt);

  // HOST: broadcast play/pause + track changes immediately, plus a periodic
  // position tick so guests can correct drift and catch seeks.
  useEffect(() => {
    if (!code || !isHost) return;
    const broadcast = () => {
      const ps = usePlayerStore.getState();
      setPlayback(ps.isPlaying, ps.currentTime).catch((error: unknown) => {
        toast.error(partyFailureMessage(
          "Wiedergabe konnte nicht an die Party gesendet werden",
          error,
        ));
      });
    };
    const unsub = usePlayerStore.subscribe((s, prev) => {
      if (s.isPlaying !== prev.isPlaying || s.index !== prev.index) broadcast();
    });
    const interval = window.setInterval(broadcast, 3000);
    broadcast();
    return () => {
      unsub();
      window.clearInterval(interval);
    };
  }, [code, isHost, setPlayback]);

  // GUEST: follow the host's broadcast. Reconcile immediately on host-state
  // changes and once a second for drift (accounting for elapsed time since the
  // host's last update). Seeks only when drift exceeds ~1.5s.
  useEffect(() => {
    if (!code || isHost || !party) return;
    const reconcile = () => {
      const ps = usePlayerStore.getState();
      if (ps.index < 0) return;
      let expected = hostPosition;
      if (hostIsPlaying && hostUpdatedAt != null) {
        expected = hostPosition + (Date.now() - hostUpdatedAt) / 1000;
      }
      const drift = Math.abs(ps.currentTime - expected);
      const seekTo = drift > 1.5 ? Math.max(0, expected) : null;
      if (ps.isPlaying !== hostIsPlaying || seekTo != null) {
        followHostPlayback(hostIsPlaying, seekTo);
      }
    };
    reconcile();
    const interval = window.setInterval(reconcile, 1000);
    return () => window.clearInterval(interval);
  }, [
    code,
    isHost,
    party,
    hostIsPlaying,
    hostPosition,
    hostUpdatedAt,
    followHostPlayback,
  ]);

  const [copied, setCopied] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  // Term of the last completed search — drives the "keine Treffer" empty state.
  const [searchedTerm, setSearchedTerm] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [queuePending, setQueuePending] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const queueBusy = useRef(false);
  const leaveBusy = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchRequests] = useState(createPartySearchRequests);

  useEffect(() => () => {
    searchRequests.cancel();
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
  }, [searchRequests]);

  // Join on mount; a failed join gets a visible retry instead of only a toast.
  useEffect(() => {
    if (!code) return;
    let active = true;
    join()
      .then(() => {
        if (active) setJoinError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = partyFailureMessage("Beitritt zur Party fehlgeschlagen", error);
        setJoinError(message);
        toast.error(message);
      });
    return () => { active = false; };
  }, [code, join]);

  const retryJoin = async () => {
    setJoining(true);
    try {
      await join();
      setJoinError(null);
    } catch (error) {
      const message = partyFailureMessage("Beitritt zur Party fehlgeschlagen", error);
      setJoinError(message);
      toast.error(message);
    } finally {
      setJoining(false);
    }
  };

  const isClient = useSyncExternalStore(
    subscribeToClientState,
    getClientSnapshot,
    getServerSnapshot,
  );
  const shareUrl = isClient
    ? new URL(
        `/party/${encodeURIComponent(code)}`,
        window.location.origin,
      ).toString()
    : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      toast.error(partyFailureMessage("Link konnte nicht kopiert werden", error));
    }
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    const request = searchRequests.start();
    setSearching(true);
    setSearchError(null);
    setResults([]);
    setSearchedTerm(null);
    try {
      const tracks = await api.search(term, "track", request.signal);
      if (!request.isCurrent()) return;
      setResults(tracks);
      setSearchedTerm(term);
    } catch (error) {
      if (!request.isCurrent()) return;
      const message = partyFailureMessage(`Suche nach "${term}" fehlgeschlagen`, error);
      setSearchError(message);
    } finally {
      if (request.isCurrent()) setSearching(false);
    }
  };

  const onLeave = async () => {
    if (leaveBusy.current || queueBusy.current) return;
    leaveBusy.current = true;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leavePartyAndNavigate(leave, () => router.push("/"));
    } catch (error) {
      const message = partyFailureMessage("Party konnte nicht verlassen werden", error);
      setLeaveError(message);
      toast.error(message);
    } finally {
      leaveBusy.current = false;
      setLeaving(false);
    }
  };

  const mutateQueue = async (
    action: string,
    operation: () => Promise<void>,
    successMessage?: string,
  ) => {
    if (queueBusy.current || leaveBusy.current) return;
    queueBusy.current = true;
    setQueuePending(true);
    setQueueError(null);
    try {
      await operation();
      if (successMessage) toast.success(successMessage);
    } catch (error) {
      const message = partyFailureMessage(action, error);
      setQueueError(message);
      toast.error(message);
    } finally {
      queueBusy.current = false;
      setQueuePending(false);
    }
  };

  const reloadParty = async () => {
    setReloading(true);
    try {
      await refetch({ throwOnError: true });
    } catch (error) {
      toast.error(partyFailureMessage("Party konnte nicht geladen werden", error));
    } finally {
      setReloading(false);
    }
  };

  const partyLoadError = error
    ? partyFailureMessage("Party konnte nicht geladen werden", error)
    : "Die API hat keine Party-Daten zurückgegeben.";

  if (joinError) {
    return (
      <div className="animate-in max-w-3xl space-y-4">
        <p role="alert" className="error-panel">{joinError}</p>
        <button
          type="button"
          onClick={retryJoin}
          disabled={joining}
          className="action-primary"
        >
          {joining ? "Beitritt wird versucht…" : "Erneut versuchen"}
        </button>
      </div>
    );
  }
  if (isLoading && !party) {
    return <p className="text-muted animate-in">Party wird geladen…</p>;
  }
  if (!party) {
    return (
      <div className="animate-in max-w-3xl space-y-4">
        <p role="alert" className="error-panel">{partyLoadError}</p>
        <button
          type="button"
          onClick={reloadParty}
          disabled={reloading}
          className="action-primary"
        >
          {reloading ? "Party wird geladen…" : "Erneut laden"}
        </button>
      </div>
    );
  }

  const tracks = party.tracks;
  const trackIds = tracks.map((track) => track.id);
  const queueDisabled = queuePending || leaving;

  return (
    <div className="animate-in">
      <header className="page-header">
        <div>
        <p className="page-eyebrow">Gemeinsam hören</p>
        <h1 className="page-title">{party.name || "Party"}</h1>
        <p className="page-description">
          Code: {party.code} ·{" "}
          {isHost ? (
            <span className="text-accent font-medium">Du bist Host</span>
          ) : (
            <>
              Host: <span className="text-foreground">{party.host_name}</span>
            </>
          )}
        </p>
        </div>
      </header>

      {isError && (
        <div role="alert" className="error-panel mb-6">
          <p className="mb-3 text-sm">{partyLoadError}</p>
          <button
            type="button"
            onClick={reloadParty}
            disabled={reloading}
            className="action-secondary"
          >
            {reloading ? "Party wird geladen…" : "Erneut laden"}
          </button>
        </div>
      )}

      {!isHost && (
        <div className="surface-card mb-6 flex items-start gap-3 px-4 py-3 text-sm leading-relaxed text-muted">
          <span aria-hidden="true">🎧</span>
          Der Host steuert die Wiedergabe. Deine Wiedergabe folgt automatisch – du
          kannst weiterhin Songs zur Warteschlange hinzufügen.
        </div>
      )}

      {/* Wide screens: queue/search as main column, share/members as sidebar. */}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <aside className="order-2 flex min-w-0 flex-col gap-5">
      <section className="surface-card p-4 sm:p-5">
        <p className="mb-4 text-base font-semibold tracking-tight">
          Teilen
        </p>
        <div className="mb-4 flex flex-col items-center rounded-xl border border-border bg-background-elevated p-4 text-center">
          {shareUrl ? (
            <div className="rounded-xl bg-white p-2">
              <QRCodeSVG
                value={shareUrl}
                size={176}
                level="M"
                marginSize={2}
                title={`QR-Code für die Party ${party.code}`}
                className="h-auto w-full max-w-44"
              />
            </div>
          ) : (
            <div
              className="aspect-square w-44 animate-pulse rounded-xl bg-white/10"
              aria-label="QR-Code wird erstellt"
            />
          )}
          <p className="mt-3 text-sm font-medium text-foreground">
            Scannen, um der Party beizutreten
          </p>
          <p className="mt-1 text-xs text-muted">
            Kamera öffnen, QR-Code scannen und direkt mitmachen.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            value={shareUrl}
            aria-label="Einladungslink"
            className="field-input min-w-0 flex-1 text-xs"
          />
          <button
            type="button"
            onClick={copyLink}
            disabled={!shareUrl}
            className="action-secondary shrink-0 disabled:cursor-wait"
          >
            {copied ? "Kopiert!" : "Kopieren"}
          </button>
        </div>
      </section>

      <section className="surface-card p-4 sm:p-5">
        <p className="mb-4 text-base font-semibold tracking-tight">
          Mitglieder ({party.members.length})
        </p>
        <div className="flex flex-wrap gap-2">
          {party.members.map((m) => (
            <span
              key={m.name}
              className="flex max-w-full items-center gap-2 rounded-xl border border-border bg-background-elevated px-3 py-2 text-sm text-foreground"
            >
              <Avatar src={m.avatar_url} name={m.name} size={28} />
              {m.name}
            </span>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={onLeave}
        disabled={queueDisabled}
        className="action-secondary self-start"
      >
        {leaving ? "Party wird verlassen…" : "Party verlassen"}
      </button>
      {leaveError && <p role="alert" className="error-panel">{leaveError}</p>}
      </aside>

      <div className="order-1 min-w-0 space-y-5">
      {queueError && <p role="alert" className="error-panel">{queueError}</p>}
      <section className="surface-card p-4 sm:p-5">
        <p className="mb-4 text-base font-semibold tracking-tight">
          Songs hinzufügen
        </p>
        <form onSubmit={runSearch} aria-busy={searching} className="mb-4 flex flex-col items-stretch gap-2 sm:flex-row">
          <input
            value={q}
            onChange={(e) => {
              searchRequests.cancel();
              setQ(e.target.value);
              setSearching(false);
              setSearchError(null);
              setResults([]);
              setSearchedTerm(null);
            }}
            aria-label="Nach Titeln für die Party suchen"
            placeholder="Nach Titeln suchen…"
            className="field-input min-w-0 flex-1"
          />
          <button
            type="submit"
            disabled={searching || !q.trim()}
            className="action-primary shrink-0"
          >
            {searching ? "Sucht…" : "Suchen"}
          </button>
        </form>
        {searching && <p role="status" className="text-sm text-muted">Titel werden gesucht…</p>}
        {searchError && <p role="alert" className="error-panel">{searchError}</p>}
        {results.length === 0 && searchedTerm && !searching && (
          <p className="text-sm text-muted">
            Keine Treffer für „{searchedTerm}“.
          </p>
        )}
        {results.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1">
            {results.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-panel-hover"
              >
                {t.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.cover}
                    alt=""
                    className="h-11 w-11 flex-shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <CoverPlaceholder className="h-11 w-11 flex-shrink-0 rounded-lg" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="truncate text-xs text-muted">
                    {trackArtistLabel(t)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => mutateQueue(
                    `"${t.title}" konnte nicht hinzugefügt werden`,
                    () => add(t),
                    "Zur Party hinzugefügt.",
                  )}
                  disabled={queueDisabled}
                  aria-label={`"${t.title}" zur Party hinzufügen`}
                  className="action-secondary ml-auto min-w-11 shrink-0 px-3"
                >
                  <span aria-hidden="true">+</span>
                  <span className="hidden sm:inline">Hinzufügen</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-busy={queuePending} className="surface-card p-4 sm:p-5">
        <p className="mb-4 text-base font-semibold tracking-tight">
          Warteschlange ({tracks.length})
        </p>
        {queuePending && <p role="status" className="mb-2 text-sm text-muted">Warteschlange wird aktualisiert…</p>}
        {tracks.length === 0 ? (
          <p className="text-sm text-muted">Noch keine Songs in der Party.</p>
        ) : (
          <ul className="flex flex-col">
            {tracks.map((t, i) => {
              const isCurrent = i === party.current_index;
              return (
                <li
                  key={t.id}
                  className={`group flex flex-wrap items-center gap-2 rounded-xl px-3 py-3 transition hover:bg-panel-hover ${
                    isCurrent ? "bg-accent/10 ring-1 ring-accent/20" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => mutateQueue(
                      `"${t.title}" konnte nicht abgespielt werden`,
                      () => setCurrent(i),
                    )}
                    disabled={!isHost || queueDisabled}
                    title={
                      isHost ? "Diesen Song abspielen" : "Nur der Host kann steuern"
                    }
                    className="flex min-w-0 flex-1 basis-full items-center gap-3 text-left disabled:cursor-default sm:basis-auto"
                  >
                    {t.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.cover}
                        alt=""
                        className="h-11 w-11 flex-shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <CoverPlaceholder className="h-11 w-11 flex-shrink-0 rounded-lg" />
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
                        {trackArtistLabel(t)} · von {t.added_by}
                      </div>
                    </div>
                  </button>

                  {isCurrent && (
                    <span className="text-accent flex-shrink-0" aria-hidden="true">
                      <PlayIcon />
                    </span>
                  )}

                  <span className="mr-auto pl-14 text-xs tabular-nums text-muted sm:mr-0 sm:pl-0">
                    {formatTime(t.duration_sec)}
                  </span>

                  {isHost && (
                    <div className="ml-auto flex flex-shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => mutateQueue(
                          `"${t.title}" konnte nicht nach oben verschoben werden`,
                          () => reorder(swap(trackIds, i, i - 1)),
                        )}
                        disabled={i === 0 || queueDisabled}
                        aria-label={`"${t.title}" nach oben verschieben`}
                        className="action-icon h-11 w-11 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => mutateQueue(
                          `"${t.title}" konnte nicht nach unten verschoben werden`,
                          () => reorder(swap(trackIds, i, i + 1)),
                        )}
                        disabled={i === tracks.length - 1 || queueDisabled}
                        aria-label={`"${t.title}" nach unten verschieben`}
                        className="action-icon h-11 w-11 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => mutateQueue(
                          `"${t.title}" konnte nicht entfernt werden`,
                          () => remove(t.id),
                        )}
                        disabled={queueDisabled}
                        aria-label={`"${t.title}" aus der Party entfernen`}
                        className="action-icon h-11 w-11 disabled:opacity-30"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      </div>
      </div>
    </div>
  );
}

function subscribeToClientState() {
  return () => {};
}

function getClientSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

// Move the id at `from` to position `to`, returning the new id ordering.
function swap(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
