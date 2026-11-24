"use client";

import { use, useState, type FormEvent } from "react";
import { useMe } from "@/hooks/useAuth";
import { usePlayerStore } from "@/store/player";
import ConfirmDialog from "@/components/ConfirmDialog";
import { CheckCircleIcon, CopyIcon, InfoCircleIcon } from "@/components/feedbackIcons";
import { EditIcon } from "@/components/icons";
import MembersCard from "./MembersCard";
import PartyQueue from "./PartyQueue";
import PartySearch from "./PartySearch";
import { PartyBlocked, PartyEnded, PartySkeleton } from "./PartyStates";
import GuestParty from "./GuestParty";
import ShareCard from "./ShareCard";
import { usePartySearch } from "./usePartySearch";
import { usePartySession } from "./usePartySession";
import { useShareLink } from "./useShareLink";

export default function PartyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { data: me } = useMe();
  // Without an approved account you take part anonymously with a nickname.
  return me?.is_approved ? <MemberParty code={code} /> : <GuestParty code={code} />;
}

/** Spotify Jam-aligned party view for signed-in accounts. */
function MemberParty({ code }: { code: string }) {
  const session = usePartySession(code);
  const buffering = usePlayerStore((s) => s.isBuffering);
  const search = usePartySearch();
  const share = useShareLink(code);
  const [confirmExit, setConfirmExit] = useState<"leave" | "end" | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const { party, isHost, guestsCanControl } = session;

  if (session.ended) {
    return <PartyEnded reason={session.endedReason ?? "Diese Jam wurde beendet."} />;
  }
  if (session.joinError) {
    return (
      <PartyBlocked
        title="Beitritt nicht möglich"
        message={session.joinError}
        retryLabel="Erneut versuchen"
        busyLabel="Beitritt wird versucht…"
        busy={session.joining}
        onRetry={session.retryJoin}
      />
    );
  }
  if (session.isLoading && !party) return <PartySkeleton />;
  if (!party) {
    return (
      <PartyBlocked
        title="Jam nicht verfügbar"
        message={session.loadError}
        retryLabel="Erneut laden"
        busyLabel="Jam wird geladen…"
        busy={session.reloading}
        onRetry={session.reload}
      />
    );
  }

  const startRename = () => {
    setDraftName(party.name || "");
    setEditingName(true);
  };

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draftName.trim();
    if (!trimmed) return;
    setEditingName(false);
    void session.saveSettings({ name: trimmed }, "Jam umbenannt.");
  };

  return (
    <div className="animate-in">
      <header className="mb-8 grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="page-eyebrow">Gemeinsam hören · Jam</p>
          {editingName ? (
            <form onSubmit={submitRename} className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                maxLength={80}
                autoFocus
                aria-label="Jam-Name"
                placeholder="Name der Jam"
                className="field-input max-w-md font-display text-xl font-bold"
              />
              <button type="submit" disabled={!draftName.trim() || session.settingsPending} className="action-primary min-h-11 px-4 text-sm">
                Speichern
              </button>
              <button type="button" onClick={() => setEditingName(false)} className="action-secondary min-h-11 px-4 text-sm">
                Abbrechen
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="page-title">{party.name || "Jam"}</h1>
              {isHost && (
                <button
                  type="button"
                  onClick={startRename}
                  disabled={session.settingsPending}
                  aria-label="Jam umbenennen"
                  title="Jam umbenennen"
                  className="action-icon mt-1 h-10 w-10 shrink-0"
                >
                  <EditIcon width={18} height={18} />
                </button>
              )}
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            <p className="label-mono flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              {session.isStale ? (
                <span className="flex items-center gap-2 text-danger">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-danger" />
                  Nicht aktuell
                </span>
              ) : (
                <span className="flex items-center gap-2 text-accent">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
                  Live
                </span>
              )}
              <span aria-hidden="true" className="text-subtle">
                /
              </span>
              {isHost ? (
                <span className="text-foreground">Du bist Host</span>
              ) : (
                <span className="min-w-0 break-words">
                  Host <span className="normal-case text-foreground">{party.host_name}</span>
                </span>
              )}
              <span aria-hidden="true" className="text-subtle">
                /
              </span>
              <span className="tabular-nums">
                {party.members.length} {party.members.length === 1 ? "Person" : "Personen"}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {isHost ? (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmExit("end")}
                    disabled={session.queueLocked}
                    className="action-secondary border-danger/35 text-danger hover:border-danger hover:bg-danger/10"
                  >
                    {session.leaving ? "Wird beendet…" : "Jam beenden"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmExit("leave")}
                    disabled={session.queueLocked}
                    className="action-secondary"
                  >
                    Verlassen
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmExit("leave")}
                  disabled={session.queueLocked}
                  className="action-secondary"
                >
                  {session.leaving ? "Jam wird verlassen…" : "Jam verlassen"}
                </button>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={share.copy}
          disabled={!share.shareUrl}
          className="group flex min-h-11 w-full min-w-0 items-end justify-between gap-6 border-y border-hairline py-3 text-left transition-colors hover:border-foreground/30 disabled:opacity-60 motion-reduce:transition-none lg:w-auto lg:flex-col lg:items-end lg:justify-end lg:gap-2 lg:border-y-0 lg:border-l lg:py-1 lg:pl-8 lg:text-right"
        >
          <span className="min-w-0">
            <span className="label-mono block">Jam-Code</span>
            <span className="mt-1.5 block break-all font-mono text-[clamp(2.25rem,10vw,3.5rem)] font-semibold leading-none tracking-[0.1em] text-foreground tabular-nums">
              {party.code}
            </span>
          </span>
          <span
            aria-live="polite"
            className={`label-mono flex shrink-0 items-center gap-2 pb-1 transition-colors motion-reduce:transition-none ${
              share.copied ? "text-success" : "group-hover:text-foreground"
            }`}
          >
            {share.copied ? <CheckCircleIcon width={15} height={15} /> : <CopyIcon width={15} height={15} />}
            {share.copied ? "Link kopiert" : "Link kopieren"}
          </span>
        </button>
      </header>

      {session.leaveError && (
        <p role="alert" className="error-panel mb-4">
          {session.leaveError}
        </p>
      )}
      {session.isStale && (
        <div className="error-panel mb-4 flex flex-wrap items-center justify-between gap-3">
          <p role="alert" className="min-w-0">
            {session.loadError}
          </p>
          <button type="button" onClick={session.reload} disabled={session.reloading} className="action-secondary min-h-9 px-4 text-xs">
            {session.reloading ? "Jam wird geladen…" : "Erneut laden"}
          </button>
        </div>
      )}

      {/* Jam mode controls bar: host guest-control switch OR non-host local audio toggle */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-panel)] border border-hairline bg-panel/70 px-4 py-3">
        {isHost ? (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Gäste dürfen Wiedergabe steuern</p>
              <p className="text-xs leading-relaxed text-muted">
                Wenn aktiv, können alle in der Jam Songs abspielen, pausieren, überspringen und die Reihenfolge ändern.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={guestsCanControl}
              disabled={session.settingsPending}
              onClick={() =>
                void session.saveSettings(
                  { guests_can_control: !guestsCanControl },
                  !guestsCanControl ? "Teilnehmer dürfen jetzt steuern." : "Nur noch du steuerst die Wiedergabe.",
                )
              }
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                guestsCanControl
                  ? "border-accent bg-accent"
                  : "border-border bg-white/10"
              }`}
            >
              <span className="sr-only">Gäste dürfen Wiedergabe steuern</span>
              <span
                aria-hidden="true"
                className={`h-5 w-5 rounded-full transition-transform ${
                  guestsCanControl
                    ? "translate-x-6 bg-on-accent"
                    : "translate-x-1 bg-foreground"
                }`}
              />
            </button>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-start gap-3 text-sm leading-relaxed text-muted">
              <InfoCircleIcon width={18} height={18} className="mt-0.5 shrink-0 text-muted" />
              <span>
                {guestsCanControl ? (
                  <>
                    <span className="font-medium text-foreground">Alle steuern die Wiedergabe.</span>{" "}
                    {session.listenLocally
                      ? "Deine Wiedergabe läuft synchron auf diesem Gerät."
                      : "Du steuerst die Jam ohne eigene Audio-Ausgabe."}
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">{party.host_name} steuert die Wiedergabe.</span>{" "}
                    {session.listenLocally
                      ? "Deine Wiedergabe folgt automatisch – Songs kannst du jederzeit hinzufügen."
                      : "Audio läuft nur beim Host – du kannst Songs beisteuern ohne Echo im Raum."}
                  </>
                )}
              </span>
            </div>
            <div role="group" aria-label="Hörmodus" className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                aria-pressed={session.listenLocally}
                onClick={() => session.setListenLocally(true)}
                className="filter-chip min-h-9"
              >
                Hier mithören
              </button>
              <button
                type="button"
                aria-pressed={!session.listenLocally}
                onClick={() => session.setListenLocally(false)}
                className="filter-chip min-h-9"
              >
                Nur steuern
              </button>
            </div>
          </>
        )}
      </div>

      <div className="grid items-start gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-10">
          <PartySearch
            search={search}
            disabled={session.queueLocked}
            onAdd={session.addTrack}
            onAddNext={session.addTrackNext}
          />
          <PartyQueue
            tracks={party.tracks}
            currentIndex={party.current_index}
            isHost={isHost}
            guestsCanControl={guestsCanControl}
            isPlaying={party.is_playing}
            viewerKey={party.viewer_key}
            hostName={party.host_name}
            bufferingCurrent={buffering}
            pending={session.queuePending}
            locked={session.queueLocked}
            error={session.queueError}
            onPlay={session.playAt}
            onTogglePlayback={session.togglePlayback}
            onNext={session.nextTrack}
            onPrev={session.prevTrack}
            onMove={session.moveTrack}
            onRemove={session.removeTrack}
          />
        </div>
        <aside className="flex min-w-0 flex-col gap-10">
          <MembersCard
            members={party.members}
            hostName={party.host_name}
            isHost={isHost}
            locked={session.queueLocked}
            onKick={session.kickMember}
          />
          <ShareCard code={party.code} shareUrl={share.shareUrl} copied={share.copied} onCopy={share.copy} />
        </aside>
      </div>

      <ConfirmDialog
        open={confirmExit !== null}
        title={confirmExit === "end" ? "Jam für alle beenden?" : "Jam verlassen?"}
        confirmLabel={confirmExit === "end" ? "Jam beenden" : "Verlassen"}
        cancelLabel="Bleiben"
        destructive
        busy={session.leaving}
        onCancel={() => setConfirmExit(null)}
        onConfirm={() => {
          const action = confirmExit;
          setConfirmExit(null);
          if (action === "end") void session.endParty();
          else void session.leaveParty();
        }}
      >
        {confirmExit === "end"
          ? "Die Jam wird für alle Teilnehmer beendet und die gemeinsame Warteschlange geschlossen."
          : isHost
            ? "Du verlässt diese Jam als Host."
            : "Deine Wiedergabe folgt danach nicht mehr dem Host. Über den Einladungslink kannst du wieder beitreten."}
      </ConfirmDialog>
    </div>
  );
}
