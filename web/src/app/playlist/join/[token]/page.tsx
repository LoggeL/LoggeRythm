"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { isValidPlaylistInviteToken } from "@/lib/authRedirect";
import { playlistPath } from "@/lib/slugs";
import {
  useAcceptPlaylistInvite,
  usePlaylistInvitePreview,
} from "@/hooks/useLibrary";
import { toast } from "@/store/toast";
import Avatar from "@/components/Avatar";
import Cover from "@/components/ui/Cover";
import { CheckCircleIcon } from "@/components/feedbackIcons";
import { SpinnerIcon, UsersIcon } from "@/components/icons";
import type { PlaylistInvitePreview } from "@/types";

function decodeToken(raw: string): string {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function inviteErrorCopy(error: unknown): {
  title: string;
  body: string;
  retryable: boolean;
} {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return {
        title: "Einladungslink nicht gefunden",
        body: "Dieser Einladungslink ist ungültig oder die zugehörige Playlist existiert nicht mehr.",
        retryable: false,
      };
    }
    if (error.status === 410) {
      return {
        title: "Einladungslink nicht mehr aktiv",
        body: "Dieser Link wurde widerrufen, ist abgelaufen oder die gemeinsame Bearbeitung der Playlist wurde deaktiviert.",
        retryable: false,
      };
    }
  }
  const detail = error instanceof Error ? error.message : String(error);
  return {
    title: "Einladung konnte nicht geladen werden",
    body: detail,
    retryable: true,
  };
}

function JoinCardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Einladung wird geladen"
      className="surface-card mx-auto my-8 max-w-lg p-6 sm:p-8"
    >
      <div className="skeleton mb-4 h-3.5 w-36 rounded" />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="skeleton h-28 w-28 shrink-0 rounded-[var(--radius-card)]" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="skeleton h-7 w-3/4 rounded" />
          <div className="skeleton h-4 w-1/2 rounded" />
          <div className="skeleton h-3.5 w-2/3 rounded" />
        </div>
      </div>
      <div className="mt-6 flex gap-3">
        <div className="skeleton h-11 flex-1 rounded-[var(--radius-control)]" />
        <div className="skeleton h-11 w-32 rounded-[var(--radius-control)]" />
      </div>
    </div>
  );
}

function PreviewCard({
  preview,
  joining,
  joinError,
  onJoin,
}: {
  preview: PlaylistInvitePreview;
  joining: boolean;
  joinError: string | null;
  onJoin: () => void;
}) {
  const targetPath = playlistPath({
    id: preview.playlist_id,
    name: preview.name,
  });
  const totalMembers = 1 + preview.collaborator_count;
  const ownerName = preview.owner.display_name || "Unbekannt";
  const alreadyIn = preview.is_owner || preview.already_collaborator;

  return (
    <section
      aria-labelledby="playlist-invite-title"
      className="surface-card animate-in mx-auto my-6 max-w-xl p-6 sm:my-10 sm:p-8"
    >
      <p className="page-eyebrow">Einladung · Gemeinsame Playlist</p>
      <div className="mt-2 flex flex-col gap-5 sm:flex-row sm:items-center">
        <Cover
          src={preview.cover_url ?? undefined}
          eager
          className="cover-shadow h-32 w-32 shrink-0 rounded-[var(--radius-card)] sm:h-36 sm:w-36"
        />
        <div className="min-w-0 flex-1">
          <h1
            id="playlist-invite-title"
            className="font-display text-2xl font-extrabold leading-[1.08] tracking-[-0.035em] [overflow-wrap:anywhere] sm:text-3xl"
          >
            {preview.name}
          </h1>
          {preview.description && (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">
              {preview.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Avatar
              src={preview.owner.avatar_url}
              name={ownerName}
              size={22}
            />
            <span>
              von <strong className="font-semibold text-foreground">{ownerName}</strong>
            </span>
          </div>
          <p className="label-mono mt-2.5 flex flex-wrap items-center gap-2 tabular-nums">
            <span>{preview.track_count} Titel</span>
            <span aria-hidden="true" className="text-subtle">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UsersIcon width={13} height={13} aria-hidden="true" />
              {totalMembers} {totalMembers === 1 ? "Person" : "Personen"}
            </span>
          </p>
        </div>
      </div>

      {alreadyIn ? (
        <div className="mt-6 rounded-[var(--radius-control)] border border-hairline bg-foreground/[0.03] px-4 py-3 text-sm text-muted">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <CheckCircleIcon width={17} height={17} className="shrink-0 text-success" aria-hidden="true" />
            {preview.is_owner
              ? "Du bist Eigentümer:in dieser Playlist."
              : "Du bist bereits Mitwirkende:r dieser Playlist."}
          </p>
        </div>
      ) : (
        <p className="mt-6 text-sm leading-relaxed text-muted">
          Als Mitwirkende:r kannst du Titel hinzufügen, entfernen und die Reihenfolge ändern.
        </p>
      )}

      {joinError && (
        <p role="alert" className="error-panel mt-5">
          Beitritt fehlgeschlagen: {joinError}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
        {alreadyIn ? (
          <Link href={targetPath} className="action-primary min-h-11 flex-1 text-center">
            Playlist öffnen
          </Link>
        ) : (
          <button
            type="button"
            onClick={onJoin}
            disabled={joining}
            aria-busy={joining}
            className="action-primary min-h-11 flex-1"
          >
            {joining ? (
              <>
                <SpinnerIcon width={18} height={18} className="animate-spin" aria-hidden="true" />
                Wird beigetreten…
              </>
            ) : (
              "Playlist beitreten"
            )}
          </button>
        )}
        <Link href="/library" className="action-secondary min-h-11 text-center">
          Zur Bibliothek
        </Link>
      </div>
    </section>
  );
}

export default function PlaylistJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = use(params);
  const token = decodeToken(rawToken);
  const validToken = isValidPlaylistInviteToken(token);
  const router = useRouter();
  const preview = usePlaylistInvitePreview(token, validToken);
  const accept = useAcceptPlaylistInvite(token);

  if (!validToken) {
    return (
      <section
        role="alert"
        aria-labelledby="invite-invalid-title"
        className="surface-card mx-auto my-8 max-w-lg p-6 sm:p-8"
      >
        <p className="page-eyebrow">Einladung</p>
        <h1
          id="invite-invalid-title"
          className="font-display text-2xl font-extrabold tracking-[-0.03em]"
        >
          Ungültiger Einladungslink
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Dieser Link hat kein gültiges Einladungsformat. Bitte lass dir von der Playlist-Leitung einen neuen Link senden.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/library" className="action-primary">
            Zur Bibliothek
          </Link>
        </div>
      </section>
    );
  }

  if (preview.isLoading) {
    return <JoinCardSkeleton />;
  }

  if (preview.isError || !preview.data) {
    const err = preview.error
      ? inviteErrorCopy(preview.error)
      : {
          title: "Einladung konnte nicht geladen werden",
          body: "Der Server hat keine Einladungsdaten zurückgegeben.",
          retryable: true,
        };
    return (
      <section
        role="alert"
        aria-labelledby="invite-error-title"
        className="surface-card mx-auto my-8 max-w-lg p-6 sm:p-8"
      >
        <p className="page-eyebrow">Einladung</p>
        <h1
          id="invite-error-title"
          className="font-display text-2xl font-extrabold tracking-[-0.03em]"
        >
          {err.title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted [overflow-wrap:anywhere]">
          {err.body}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {err.retryable && (
            <button
              type="button"
              disabled={preview.isFetching}
              onClick={() => void preview.refetch()}
              className="action-primary"
            >
              {preview.isFetching ? "Wird geladen…" : "Erneut versuchen"}
            </button>
          )}
          <Link href="/library" className="action-secondary">
            Zur Bibliothek
          </Link>
        </div>
      </section>
    );
  }

  function handleJoin() {
    if (accept.isPending) return;
    accept.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(
          result.already_member
            ? `Du bist bereits in „${result.playlist_name}“.`
            : `Du arbeitest jetzt an „${result.playlist_name}“ mit.`,
        );
        router.push(
          playlistPath({ id: result.playlist_id, name: result.playlist_name }),
        );
      },
    });
  }

  return (
    <PreviewCard
      preview={preview.data}
      joining={accept.isPending}
      joinError={accept.isError ? accept.error.message : null}
      onJoin={handleJoin}
    />
  );
}
