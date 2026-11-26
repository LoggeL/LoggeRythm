"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import {
  useAddPlaylistCollaborator,
  useCreatePlaylistInvite,
  usePlaylistInvite,
  useRemovePlaylistCollaborator,
  useRevokePlaylistInvite,
  useSetPlaylistCollaborative,
} from "@/hooks/useLibrary";
import { emailError } from "@/components/AuthFields";
import { playlistJoinPath } from "@/lib/slugs";
import { playlistMemberCount } from "@/lib/playlistPermissions";
import { toast } from "@/store/toast";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import QueryError from "@/components/ui/QueryError";
import { CheckCircleIcon, CopyIcon, InfoCircleIcon } from "@/components/feedbackIcons";
import { CloseIcon, LinkIcon, LogOutIcon, RefreshIcon, TrashIcon, UserPlusIcon } from "@/components/icons";
import type { Playlist } from "@/types";

const subscribeNever = () => () => {};
const onClient = () => true;
const onServer = () => false;

function useCopyText() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      toast.error(
        `Link konnte nicht kopiert werden: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { copied, copy };
}

/**
 * Manage collaborative playlist settings, invite link (+ QR code), direct email
 * invites, and collaborator membership. Owners get full controls; collaborators
 * see the member list and can leave the playlist.
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
  const isClient = useSyncExternalStore(subscribeNever, onClient, onServer);

  const toggleCollaborative = useSetPlaylistCollaborative(id);
  const inviteQuery = usePlaylistInvite(id, isOwner && isCollaborative);
  const createInvite = useCreatePlaylistInvite(id);
  const revokeInvite = useRevokePlaylistInvite(id);
  const addCollaborator = useAddPlaylistCollaborator(id);
  const removeCollaborator = useRemovePlaylistCollaborator(id);
  const clipboard = useCopyText();

  const [showQr, setShowQr] = useState(false);
  const [email, setEmail] = useState("");
  const [emailValidation, setEmailValidation] = useState<string | null>(null);
  const emailInputId = useId();
  const emailErrorId = useId();

  const invite = inviteQuery.data?.invite ?? null;
  const inviteUrl =
    isClient && invite
      ? new URL(playlistJoinPath(invite.token), window.location.origin).toString()
      : "";

  const busy =
    toggleCollaborative.isPending ||
    createInvite.isPending ||
    revokeInvite.isPending ||
    addCollaborator.isPending;

  function submitEmailInvite(event: FormEvent) {
    event.preventDefault();
    if (addCollaborator.isPending) return;
    const trimmed = email.trim();
    const invalid = emailError(trimmed);
    setEmailValidation(invalid);
    if (invalid) return;
    addCollaborator.mutate(trimmed, {
      onSuccess: () => {
        setEmail("");
        setEmailValidation(null);
      },
    });
  }

  function handleRotateOrCreateInvite(isRotation: boolean) {
    if (createInvite.isPending) return;
    createInvite.mutate(undefined, {
      onSuccess: () => {
        toast.success(
          isRotation
            ? "Neuer Einladungslink erstellt. Der alte Link ist nicht mehr gültig."
            : "Einladungslink erstellt.",
        );
      },
    });
  }

  const ownerName = playlist.owner_name || "Unbekannt";

  return (
    <Modal
      open
      size="md"
      onClose={onClose}
      title={isOwner ? "Mitwirkende & Einladung" : "Mitwirkende"}
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
                    ? "Beim Deaktivieren werden Einladungslinks widerrufen; bestehende Mitwirkende behalten Lesezugriff."
                    : "Aktiviere die Zusammenarbeit, um Einladungslinks zu erstellen oder Personen per E-Mail hinzuzufügen."}
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

        {isOwner && isCollaborative && (
          <section aria-labelledby="collab-invite-heading" className="flex flex-col gap-3">
            <h3 id="collab-invite-heading" className="label-mono">
              Einladungslink
            </h3>
            <QueryError label="Der Einladungslink" query={inviteQuery} />
            {inviteQuery.isLoading ? (
              <div role="status" aria-label="Einladungslink wird geladen" className="skeleton h-11 w-full rounded-[var(--radius-control)]" />
            ) : invite ? (
              <>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    aria-label="Einladungslink"
                    onFocus={(event) => event.currentTarget.select()}
                    className="field-input min-w-0 flex-1 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => void clipboard.copy(inviteUrl)}
                    disabled={!inviteUrl}
                    aria-label="Einladungslink kopieren"
                    className="action-primary shrink-0 px-4"
                  >
                    {clipboard.copied ? (
                      <CheckCircleIcon width={16} height={16} aria-hidden="true" />
                    ) : (
                      <CopyIcon width={16} height={16} aria-hidden="true" />
                    )}
                    <span>{clipboard.copied ? "Kopiert" : "Kopieren"}</span>
                  </button>
                </div>

                {showQr && inviteUrl && (
                  <div className="w-fit rounded-[var(--radius-card)] bg-white p-2">
                    <QRCodeSVG
                      value={inviteUrl}
                      size={144}
                      level="M"
                      marginSize={1}
                      title={`QR-Code zur Einladung für ${playlist.name}`}
                      className="h-auto w-28"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQr((value) => !value)}
                    className="action-secondary min-h-9 px-3 text-xs"
                  >
                    {showQr ? "QR-Code ausblenden" : "QR-Code anzeigen"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRotateOrCreateInvite(true)}
                    className="action-secondary min-h-9 px-3 text-xs"
                  >
                    <RefreshIcon
                      width={14}
                      height={14}
                      aria-hidden="true"
                      className={createInvite.isPending ? "animate-spin" : undefined}
                    />
                    {createInvite.isPending ? "Wird erneuert…" : "Link erneuern"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => revokeInvite.mutate()}
                    className="action-secondary action-danger min-h-9 border-danger/35 px-3 text-xs hover:border-danger/70"
                  >
                    <TrashIcon width={14} height={14} aria-hidden="true" />
                    {revokeInvite.isPending ? "Wird widerrufen…" : "Widerrufen"}
                  </button>
                </div>
              </>
            ) : !inviteQuery.isError ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-dashed border-border px-4 py-3">
                <p className="text-xs leading-relaxed text-muted">
                  Derzeit ist kein Einladungslink aktiv.
                </p>
                <button
                  type="button"
                  disabled={createInvite.isPending}
                  onClick={() => handleRotateOrCreateInvite(false)}
                  className="action-secondary min-h-9 px-3.5 text-xs"
                >
                  <LinkIcon width={15} height={15} aria-hidden="true" />
                  {createInvite.isPending
                    ? "Wird erstellt…"
                    : "Einladungslink erstellen"}
                </button>
              </div>
            ) : null}

            {createInvite.isError && (
              <p role="alert" className="error-panel">
                Einladungslink konnte nicht erstellt werden:{" "}
                {createInvite.error.message}
              </p>
            )}
            {revokeInvite.isError && (
              <p role="alert" className="error-panel">
                Einladungslink konnte nicht widerrufen werden:{" "}
                {revokeInvite.error.message}
              </p>
            )}
          </section>
        )}

        {isOwner && isCollaborative && (
          <form onSubmit={submitEmailInvite} noValidate className="flex flex-col gap-2">
            <label htmlFor={emailInputId} className="label-mono">
              Direkt per E-Mail einladen
            </label>
            <div className="flex items-center gap-2">
              <input
                id={emailInputId}
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailValidation(null);
                  if (addCollaborator.isError) addCollaborator.reset();
                }}
                placeholder="name@beispiel.de"
                disabled={addCollaborator.isPending}
                aria-invalid={
                  emailValidation || addCollaborator.isError ? true : undefined
                }
                aria-describedby={emailValidation ? emailErrorId : undefined}
                className="field-input min-w-0 flex-1 text-sm"
              />
              <button
                type="submit"
                disabled={addCollaborator.isPending || !email.trim()}
                className="action-secondary shrink-0 px-4"
              >
                <UserPlusIcon width={16} height={16} aria-hidden="true" />
                <span>
                  {addCollaborator.isPending ? "Lädt…" : "Hinzufügen"}
                </span>
              </button>
            </div>
            {emailValidation && (
              <span id={emailErrorId} role="alert" className="text-xs text-danger">
                {emailValidation}
              </span>
            )}
            {addCollaborator.isError && (
              <p role="alert" className="error-panel mt-1">
                Person konnte nicht hinzugefügt werden:{" "}
                {addCollaborator.error.message}
              </p>
            )}
          </form>
        )}

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
