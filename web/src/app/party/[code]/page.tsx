"use client";

import { use, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { CheckCircleIcon, CopyIcon, InfoCircleIcon } from "@/components/feedbackIcons";
import MembersCard from "./MembersCard";
import PartyQueue from "./PartyQueue";
import PartySearch from "./PartySearch";
import { PartyBlocked, PartySkeleton } from "./PartyStates";
import ShareCard from "./ShareCard";
import { usePartySearch } from "./usePartySearch";
import { usePartySession } from "./usePartySession";
import { useShareLink } from "./useShareLink";

export default function PartyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const session = usePartySession(code);
  const search = usePartySearch();
  const share = useShareLink(code);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { party, isHost } = session;

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
        title="Party nicht verfügbar"
        message={session.loadError}
        retryLabel="Erneut laden"
        busyLabel="Party wird geladen…"
        busy={session.reloading}
        onRetry={session.reload}
      />
    );
  }

  return (
    <div className="animate-in">
      <header className="mb-8 grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="page-eyebrow">Gemeinsam hören</p>
          <h1 className="page-title">{party.name || "Party"}</h1>
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
            <button type="button" onClick={() => setConfirmLeave(true)} disabled={session.queueLocked} className="action-secondary">
              {session.leaving ? "Party wird verlassen…" : "Party verlassen"}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={share.copy}
          disabled={!share.shareUrl}
          className="group flex min-h-11 w-full min-w-0 items-end justify-between gap-6 border-y border-hairline py-3 text-left transition-colors hover:border-foreground/30 disabled:opacity-60 motion-reduce:transition-none lg:w-auto lg:flex-col lg:items-end lg:justify-end lg:gap-2 lg:border-y-0 lg:border-l lg:py-1 lg:pl-8 lg:text-right"
        >
          <span className="min-w-0">
            <span className="label-mono block">Party-Code</span>
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
            {session.reloading ? "Party wird geladen…" : "Erneut laden"}
          </button>
        </div>
      )}
      {!isHost && (
        <p className="mb-8 flex items-start gap-3 border-l-2 border-border py-0.5 pl-4 text-sm leading-relaxed text-muted">
          <InfoCircleIcon width={18} height={18} className="mt-0.5 shrink-0 text-muted" />
          <span>
            <span className="font-medium text-foreground">{party.host_name} steuert die Wiedergabe.</span> Deine Wiedergabe folgt
            automatisch – Songs kannst du jederzeit zur Warteschlange hinzufügen.
          </span>
        </p>
      )}

      <div className="grid items-start gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-10">
          <PartySearch search={search} disabled={session.queueLocked} onAdd={session.addTrack} />
          <PartyQueue
            tracks={party.tracks}
            currentIndex={party.current_index}
            isHost={isHost}
            pending={session.queuePending}
            locked={session.queueLocked}
            error={session.queueError}
            onPlay={session.playAt}
            onMove={session.moveTrack}
            onRemove={session.removeTrack}
          />
        </div>
        <aside className="flex min-w-0 flex-col gap-10">
          <MembersCard members={party.members} hostName={party.host_name} />
          <ShareCard code={party.code} shareUrl={share.shareUrl} copied={share.copied} onCopy={share.copy} />
        </aside>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        title="Party verlassen?"
        confirmLabel="Verlassen"
        cancelLabel="Bleiben"
        destructive
        busy={session.leaving}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          void session.leaveParty();
        }}
      >
        {isHost
          ? "Du steuerst als Host die Wiedergabe für alle in dieser Party."
          : "Deine Wiedergabe folgt danach nicht mehr dem Host. Über den Einladungslink kannst du wieder beitreten."}
      </ConfirmDialog>
    </div>
  );
}
