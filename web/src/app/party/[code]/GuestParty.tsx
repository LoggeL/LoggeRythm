"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import ConfirmDialog from "@/components/ConfirmDialog";
import { TextField } from "@/components/AuthFields";
import { AuthShell } from "@/components/AuthCard";
import { InfoCircleIcon } from "@/components/feedbackIcons";
import { SpinnerIcon } from "@/components/icons";
import MembersCard from "./MembersCard";
import PartyQueue from "./PartyQueue";
import PartySearch from "./PartySearch";
import { PartyBlocked, PartyEnded, PartySkeleton } from "./PartyStates";
import { useGuestParty } from "./useGuestParty";
import { usePartySearch } from "./usePartySearch";

const NICKNAME_MAX = 40;

/**
 * A Jam for people without an account: pick a nickname, then watch the queue
 * live, add songs, see normal server-stored track markers, and control playback
 * when the host allows it.
 */
export default function GuestParty({ code }: { code: string }) {
  const guest = useGuestParty(code);
  const search = usePartySearch();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { phase } = guest;

  if (phase.kind === "checking") {
    return (
      <GuestFrame>
        <PartySkeleton />
      </GuestFrame>
    );
  }
  if (phase.kind === "ended") {
    return (
      <GuestFrame>
        <PartyEnded reason={phase.reason} homeHref="/login" homeLabel="Anmelden" />
      </GuestFrame>
    );
  }
  if (phase.kind === "error") {
    return (
      <GuestFrame>
        <PartyBlocked
          title="Jam nicht verfügbar"
          message={phase.message}
          retryLabel="Erneut laden"
          busyLabel="Jam wird geladen…"
          busy={false}
          onRetry={() => void guest.reload()}
        />
      </GuestFrame>
    );
  }
  if (phase.kind === "nickname" || phase.kind === "left") {
    return (
      <NicknameForm
        code={code}
        left={phase.kind === "left"}
        joining={guest.joining}
        error={guest.joinError}
        onJoin={guest.join}
      />
    );
  }

  const { party } = phase;
  const guestsCanControl = Boolean(party.guests_can_control);

  return (
    <GuestFrame>
      <div className="animate-in">
        <header className="mb-8">
          <p className="page-eyebrow">Gemeinsam hören · Jam {party.code}</p>
          <h1 className="page-title">{party.name || "Jam"}</h1>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            <p className="label-mono flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="flex items-center gap-2 text-accent">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
                Live
              </span>
              <span aria-hidden="true" className="text-subtle">/</span>
              <span className="min-w-0 break-words">
                Host <span className="normal-case text-foreground">{party.host_name}</span>
              </span>
              <span aria-hidden="true" className="text-subtle">/</span>
              <span className="min-w-0 break-words">
                Du bist <span className="normal-case text-foreground">{party.viewer_name}</span> (Gast)
              </span>
            </p>
            <button type="button" onClick={() => setConfirmLeave(true)} disabled={guest.queueLocked} className="action-secondary">
              {guest.leaving ? "Jam wird verlassen…" : "Jam verlassen"}
            </button>
          </div>
        </header>

        <p className="mb-8 flex items-start gap-3 border-l-2 border-border py-0.5 pl-4 text-sm leading-relaxed text-muted">
          <InfoCircleIcon width={18} height={18} className="mt-0.5 shrink-0 text-muted" />
          <span>
            <span className="font-medium text-foreground">Die Musik läuft bei {party.host_name}.</span>{" "}
            {guestsCanControl
              ? "Der Host erlaubt allen die Wiedergabe-Steuerung – du kannst Songs starten, pausieren, umsortieren und entfernen."
              : "Du kannst Songs zur Warteschlange hinzufügen und deine eigenen wieder entfernen, solange sie noch nicht laufen."}
          </span>
        </p>

        <div className="grid items-start gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-10">
            <PartySearch
              search={search}
              disabled={guest.queueLocked}
              isGuest
              guestCachedIds={guest.cachedIds}
              cacheError={guest.cacheError}
              onRetryCache={guest.retryCache}
              onAdd={guest.addTrack}
              onAddNext={guest.addTrackNext}
            />
            <PartyQueue
              tracks={party.tracks}
              currentIndex={party.current_index}
              isHost={false}
              guestsCanControl={guestsCanControl}
              isPlaying={party.is_playing}
              viewerKey={party.viewer_key}
              hostName={party.host_name}
              isGuest
              guestCachedIds={guest.cachedIds}
              cacheError={guest.cacheError}
              onRetryCache={guest.retryCache}
              pending={guest.queuePending}
              locked={guest.queueLocked}
              error={guest.queueError}
              onPlay={guestsCanControl ? guest.playAt : undefined}
              onTogglePlayback={guestsCanControl ? guest.togglePlayback : undefined}
              onNext={guestsCanControl ? guest.nextTrack : undefined}
              onPrev={guestsCanControl ? guest.prevTrack : undefined}
              onMove={guestsCanControl ? guest.moveTrack : undefined}
              onRemove={guest.removeTrack}
            />
          </div>
          <aside className="flex min-w-0 flex-col gap-10">
            <MembersCard members={party.members} hostName={party.host_name} />
          </aside>
        </div>

        <ConfirmDialog
          open={confirmLeave}
          title="Jam verlassen?"
          confirmLabel="Verlassen"
          cancelLabel="Bleiben"
          destructive
          busy={guest.leaving}
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            void guest.leave();
          }}
        >
          Dein Nickname wird freigegeben. Über den Einladungslink kannst du jederzeit wieder beitreten.
        </ConfirmDialog>
      </div>
    </GuestFrame>
  );
}

function GuestFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[96rem] px-4 pb-16 pt-[calc(1.5rem+env(safe-area-inset-top))] sm:px-6 lg:px-10">{children}</div>
  );
}

function NicknameForm({
  code,
  left,
  joining,
  error,
  onJoin,
}: {
  code: string;
  left: boolean;
  joining: boolean;
  error: string | null;
  onJoin: (nickname: string) => Promise<void>;
}) {
  const [nickname, setNickname] = useState("");
  const trimmed = nickname.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || joining) return;
    void onJoin(trimmed);
  };
  return (
    <AuthShell compact>
      <form onSubmit={submit} aria-labelledby="guest-join-title">
        <p className="page-eyebrow">{left ? "Du hast die Jam verlassen" : `Einladung · Jam ${code}`}</p>
        <h1 id="guest-join-title" className="text-[clamp(2rem,5vw,2.75rem)] font-extrabold leading-none tracking-[-0.04em] [text-wrap:balance]">
          {left ? "Wieder mitmachen?" : "Bei der Jam mitmachen"}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Ohne Konto: Gib einen Nickname ein, dann siehst du die Warteschlange live und kannst Songs hinzufügen.
        </p>
        <div className="mt-8">
          <TextField
            label="Nickname"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            autoFocus
            required
            error={error}
            hint={`Für alle in der Jam sichtbar · max. ${NICKNAME_MAX} Zeichen`}
          />
        </div>
        <button type="submit" disabled={!trimmed || joining} aria-busy={joining} className="action-primary mt-6 min-h-12 w-full text-[15px]">
          {joining && <SpinnerIcon width={18} height={18} aria-hidden className="animate-spin motion-reduce:animate-none" />}
          {joining ? "Tritt bei…" : "Beitreten"}
        </button>
        <p className="mt-6 text-sm text-muted">
          Du hast ein Konto?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Anmelden
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
