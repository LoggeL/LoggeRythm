"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  useInviteToPlaylist,
  usePlaylistInviteCandidates,
  usePlaylistOutgoingInvitations,
  useRemovePlaylistCollaborator,
  useSetPlaylistCollaborative,
  useWithdrawPlaylistInvitation,
} from "@/hooks/useLibrary";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  canInviteToPlaylist,
  invitationDateLabel,
  invitationUserName,
  inviteCandidateAction,
  inviteSearchQuery,
  playlistMemberCount,
} from "@/lib/playlistPermissions";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import QueryError from "@/components/ui/QueryError";
import { InfoCircleIcon } from "@/components/feedbackIcons";
import { CloseIcon, LogOutIcon, SearchIcon, UserPlusIcon } from "@/components/icons";
import type { Playlist } from "@/types";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Owner-only: find existing accounts by display name and invite them. The
 * invitee joins only after accepting in their library.
 */
function InviteSearch({ id, playlistName }: { id: string; playlistName: string }) {
  const [term, setTerm] = useState("");
  const query = inviteSearchQuery(useDebouncedValue(term, SEARCH_DEBOUNCE_MS));
  const typedQuery = inviteSearchQuery(term);
  const candidates = usePlaylistInviteCandidates(id, query ?? "", query !== null);
  const invite = useInviteToPlaylist(id);
  const inputId = useId();
  const hintId = useId();

  const results = query !== null ? candidates.data : undefined;
  const stale = candidates.isPlaceholderData || typedQuery !== query;

  return (
    <section aria-labelledby={`${inputId}-heading`} className="flex flex-col gap-2.5">
      <h3 id={`${inputId}-heading`} className="label-mono">
        Personen einladen
      </h3>
      <div className="relative">
        <SearchIcon
          width={16}
          height={16}
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <label htmlFor={inputId} className="sr-only">
          Konto nach Anzeigenamen suchen
        </label>
        <input
          id={inputId}
          type="search"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            if (invite.isError) invite.reset();
          }}
          placeholder="Anzeigename suchen…"
          aria-describedby={hintId}
          className="field-input w-full pl-10 text-sm"
        />
      </div>
      <p id={hintId} className="text-xs leading-relaxed text-muted">
        Eingeladene sehen die Einladung zu „{playlistName}“ in ihrer Bibliothek und können sie annehmen oder ablehnen.
      </p>

      {query !== null && (
        <QueryError label="Die Suchergebnisse" query={candidates} />
      )}

      {query !== null && candidates.isLoading && (
        <div
          role="status"
          aria-label="Konten werden gesucht"
          className="skeleton h-14 w-full rounded-[var(--radius-control)]"
        />
      )}

      {results && results.length === 0 && !stale && (
        <p className="rounded-[var(--radius-control)] border border-dashed border-border px-4 py-3 text-xs leading-relaxed text-muted">
          Kein Konto mit „{query}“ im Anzeigenamen gefunden.
        </p>
      )}

      {results && results.length > 0 && (
        <ul
          aria-label="Suchergebnisse"
          aria-busy={stale || undefined}
          className={`divide-y divide-hairline rounded-[var(--radius-control)] border border-hairline transition-opacity ${
            stale ? "opacity-60" : ""
          }`}
        >
          {results.map((candidate) => {
            const name = invitationUserName(candidate.user);
            const action = inviteCandidateAction(candidate.status);
            const invitingThis =
              invite.isPending && invite.variables?.userId === candidate.user.id;
            return (
              <li
                key={candidate.user.id}
                className="flex items-center gap-3 px-3.5 py-2.5"
              >
                <Avatar src={candidate.user.avatar_url} name={name} size={36} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                  {name}
                </span>
                {action.canInvite ? (
                  <button
                    type="button"
                    disabled={invite.isPending}
                    onClick={() =>
                      invite.mutate({ userId: candidate.user.id, name })
                    }
                    aria-label={`${name} einladen`}
                    className="action-secondary min-h-9 shrink-0 px-3.5 text-xs"
                  >
                    <UserPlusIcon width={15} height={15} aria-hidden="true" />
                    {invitingThis ? "Wird eingeladen…" : action.label}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="action-secondary min-h-9 shrink-0 px-3.5 text-xs"
                  >
                    {action.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {invite.isError && (
        <p role="alert" className="error-panel">
          {invite.variables?.name} konnte nicht eingeladen werden:{" "}
          {invite.error.message}
        </p>
      )}
    </section>
  );
}

/** Owner-only: invitations the invitees have not answered yet. */
function PendingInvitations({ id }: { id: string }) {
  const invitations = usePlaylistOutgoingInvitations(id);
  const withdraw = useWithdrawPlaylistInvitation(id);
  const list = invitations.data;

  if (invitations.isLoading) {
    return (
      <div
        role="status"
        aria-label="Offene Einladungen werden geladen"
        className="skeleton h-14 w-full rounded-[var(--radius-control)]"
      />
    );
  }

  return (
    <>
      <QueryError label="Die offenen Einladungen" query={invitations} />
      {list && list.length > 0 && (
        <section aria-labelledby="collab-pending-heading" className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 id="collab-pending-heading" className="label-mono">
              Offene Einladungen
            </h3>
            <span className="label-mono tabular-nums">{list.length}</span>
          </div>
          <ul className="divide-y divide-hairline rounded-[var(--radius-control)] border border-hairline">
            {list.map((invitation) => {
              const name = invitationUserName(invitation.invitee);
              const withdrawingThis =
                withdraw.isPending &&
                withdraw.variables?.userId === invitation.invitee.id;
              return (
                <li
                  key={invitation.invitee.id}
                  className="flex items-center gap-3 px-3.5 py-2.5"
                >
                  <Avatar src={invitation.invitee.avatar_url} name={name} size={36} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {name}
                    </span>
                    <span className="label-mono text-[10px]">
                      {invitationDateLabel(invitation.created_at)}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={withdraw.isPending}
                    onClick={() =>
                      withdraw.mutate({ userId: invitation.invitee.id, name })
                    }
                    aria-label={`Einladung an ${name} zurückziehen`}
                    className="action-secondary action-danger min-h-9 shrink-0 border-danger/35 px-3 text-xs hover:border-danger/70"
                  >
                    {withdrawingThis ? "Wird zurückgezogen…" : "Zurückziehen"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {withdraw.isError && (
        <p role="alert" className="error-panel">
          Einladung an {withdraw.variables?.name} konnte nicht zurückgezogen werden:{" "}
          {withdraw.error.message}
        </p>
      )}
    </>
  );
}

/**
 * Manage collaborative playlist settings, account invitations, and collaborator
 * membership. Owners get full controls; collaborators see the member list and
 * can leave the playlist.
 */
export default function CollaboratorsDialog({
  id,
  playlist,
  onClose,
  onRequestLeave,
}: {
  id: string;
  playlist: Playlist;
  onClose: () => void;
  onRequestLeave: () => void;
}) {
  const isOwner = Boolean(playlist.is_owner);
  const isCollaborator = Boolean(playlist.is_collaborator);
  const isCollaborative = Boolean(playlist.is_collaborative);
  const collaborators = playlist.collaborators ?? [];
  const memberCount = playlistMemberCount(playlist);
  const canInvite = canInviteToPlaylist(playlist);

  const toggleCollaborative = useSetPlaylistCollaborative(id);
  const removeCollaborator = useRemovePlaylistCollaborator(id);

  const ownerName = playlist.owner_name || "Unbekannt";

  return (
    <Modal
      open
      size="md"
      onClose={onClose}
      title={isOwner ? "Mitwirkende & Einladungen" : "Mitwirkende"}
      footer={
        <>
          {!isOwner && isCollaborator && (
            <button
              type="button"
              onClick={onRequestLeave}
              className="action-secondary action-danger mr-auto border-danger/40 hover:border-danger/70"
            >
              <LogOutIcon width={16} height={16} aria-hidden="true" />
              Playlist verlassen
            </button>
          )}
          <button type="button" onClick={onClose} className="action-secondary">
            Schließen
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {isOwner && (
          <div className="rounded-[var(--radius-control)] border border-hairline bg-foreground/[0.03] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  Gemeinsame Bearbeitung
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {isCollaborative
                    ? "Beim Deaktivieren werden offene Einladungen zurückgezogen; bestehende Mitwirkende behalten Lesezugriff."
                    : "Aktiviere die Zusammenarbeit, um Personen mit Konto einzuladen."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isCollaborative}
                disabled={toggleCollaborative.isPending}
                onClick={() => toggleCollaborative.mutate(!isCollaborative)}
                className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                  isCollaborative
                    ? "border-accent bg-accent"
                    : "border-border bg-white/10"
                }`}
              >
                <span className="sr-only">Gemeinsame Bearbeitung</span>
                <span
                  aria-hidden="true"
                  className={`h-5 w-5 rounded-full transition-transform ${
                    isCollaborative
                      ? "translate-x-6 bg-on-accent"
                      : "translate-x-1 bg-foreground"
                  }`}
                />
              </button>
            </div>
            {toggleCollaborative.isError && (
              <p role="alert" className="error-panel mt-3">
                Einstellung konnte nicht geändert werden:{" "}
                {toggleCollaborative.error.message}
              </p>
            )}
          </div>
        )}

        {!isOwner && isCollaborator && !isCollaborative && (
          <div className="flex items-start gap-3 rounded-[var(--radius-control)] border border-hairline bg-foreground/[0.03] px-4 py-3 text-sm text-muted">
            <InfoCircleIcon width={18} height={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Die gemeinsame Bearbeitung wurde pausiert. Du hast weiterhin Lesezugriff und kannst die Playlist jederzeit verlassen.
            </span>
          </div>
        )}

        {isOwner && !isCollaborative && (
          <section
            aria-labelledby="collab-invite-off-heading"
            className="flex flex-col gap-2.5"
          >
            <h3 id="collab-invite-off-heading" className="label-mono">
              Personen einladen
            </h3>
            <div className="flex items-start gap-3 rounded-[var(--radius-control)] border border-dashed border-border px-4 py-3 text-sm text-muted">
              <InfoCircleIcon width={18} height={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Einladen ist nur möglich, solange die gemeinsame Bearbeitung aktiv ist. Schalte sie oben ein, um Konten zu suchen und einzuladen.
              </span>
            </div>
          </section>
        )}

        {canInvite && <InviteSearch id={id} playlistName={playlist.name} />}
        {canInvite && <PendingInvitations id={id} />}

        <section aria-labelledby="collab-members-heading" className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 id="collab-members-heading" className="label-mono">
              Mitglieder
            </h3>
            <span className="label-mono tabular-nums">
              {memberCount} {memberCount === 1 ? "Person" : "Personen"}
            </span>
          </div>

          <ul className="divide-y divide-hairline rounded-[var(--radius-control)] border border-hairline">
            <li className="flex items-center gap-3 px-3.5 py-2.5">
              <Avatar
                src={playlist.owner_avatar_url}
                name={ownerName}
                size={36}
                className="ring-2 ring-accent/70 ring-offset-2 ring-offset-panel"
              />
              <div className="min-w-0 flex-1">
                {playlist.owner_id ? (
                  <Link
                    href={`/users/${playlist.owner_id}`}
                    onClick={onClose}
                    className="block truncate text-sm font-semibold text-foreground hover:underline"
                  >
                    {ownerName}
                  </Link>
                ) : (
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {ownerName}
                  </span>
                )}
                <span className="label-mono text-[10px] text-accent">
                  Eigentümer
                </span>
              </div>
            </li>

            {collaborators.map((collaborator) => {
              const name = collaborator.display_name || `Nutzer #${collaborator.user_id}`;
              const removingThis =
                removeCollaborator.isPending &&
                removeCollaborator.variables?.userId === collaborator.user_id;
              return (
                <li
                  key={collaborator.user_id}
                  className="flex items-center gap-3 px-3.5 py-2.5"
                >
                  <Avatar
                    src={collaborator.avatar_url}
                    name={name}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/users/${collaborator.user_id}`}
                      onClick={onClose}
                      className="block truncate text-sm font-semibold text-foreground hover:underline"
                    >
                      {name}
                    </Link>
                    <span className="label-mono text-[10px]">
                      {isCollaborative ? "Mitwirkend" : "Nur Lesen"}
                    </span>
                  </div>
                  {isOwner && (
                    <button
                      type="button"
                      disabled={removingThis}
                      onClick={() =>
                        removeCollaborator.mutate({
                          userId: collaborator.user_id,
                          name,
                        })
                      }
                      aria-label={`${name} entfernen`}
                      title={`${name} entfernen`}
                      className="action-icon h-9 w-9 text-muted hover:text-danger"
                    >
                      <CloseIcon width={16} height={16} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {removeCollaborator.isError && (
            <p role="alert" className="error-panel">
              Mitwirkende:r konnte nicht entfernt werden:{" "}
              {removeCollaborator.error.message}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
