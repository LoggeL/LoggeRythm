"use client";

import { useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import Avatar from "@/components/Avatar";
import ConfirmDialog from "@/components/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import { CopyIcon } from "@/components/feedbackIcons";
import { UserIcon } from "@/components/icons";
import type { AdminUser, InviteInfo } from "@/types";
import {
  Badge,
  errorMessage,
  formatCount,
  RowsSkeleton,
  SectionError,
  SettingsCard,
  StatusBadge,
} from "@/app/account/presentation";

const subscribeNever = () => () => undefined;

function UsersCard() {
  const qc = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: api.adminUsers,
  });

  const approve = useMutation({
    mutationFn: (id: string | number) => api.approveUser(id),
    onSuccess: () => {
      toast.success("Benutzer freigegeben.");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-usage"] });
    },
    onError: (err) => toast.error(`Freigabe fehlgeschlagen: ${errorMessage(err)}`),
  });

  const remove = useMutation({
    mutationFn: (id: string | number) => api.deleteUser(id),
    onSuccess: () => {
      toast.success("Benutzer entfernt.");
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-usage"] });
      qc.invalidateQueries({ queryKey: ["admin-usage-user"] });
    },
    onError: (err) => toast.error(`Entfernen fehlgeschlagen: ${errorMessage(err)}`),
  });

  const pendingCount = data?.filter((user) => !user.is_approved).length ?? 0;

  return (
    <SettingsCard
      title="Benutzer"
      description="Gib neue Konten frei oder entferne Zugänge."
      icon={<UserIcon width={18} height={18} />}
      action={pendingCount > 0 ? <Badge tone="warning">{formatCount(pendingCount)} wartend</Badge> : undefined}
    >
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Benutzer entfernen?"
        confirmLabel="Endgültig entfernen"
        destructive
        busy={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) throw new Error("Kein Benutzer zum Entfernen ausgewählt.");
          remove.mutate(pendingDelete.id);
        }}
      >
        {pendingDelete &&
          `${pendingDelete.display_name || pendingDelete.email} (${pendingDelete.email}) wird samt Playlists, Likes und Verlauf endgültig entfernt. Das kann nicht rückgängig gemacht werden.`}
      </ConfirmDialog>

      {isLoading && <RowsSkeleton label="Benutzer werden geladen" />}
      {error && <SectionError label="Die Benutzer" error={error} retrying={isFetching} onRetry={() => void refetch()} />}
      {data && data.length === 0 && (
        <EmptyState icon={<UserIcon />} title="Noch keine Benutzer">
          Erstelle unten einen Einladungslink, um jemanden einzuladen.
        </EmptyState>
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col">
          {data.map((user) => {
            const label = user.display_name || user.email;
            return (
              <li
                key={String(user.id)}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline py-3 first:border-t-0 first:pt-0 last:pb-0"
              >
                <Avatar src={user.avatar_url} name={label} size={40} />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{label}</span>
                    {user.is_admin && <Badge tone="accent">Admin</Badge>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">{user.email}</p>
                </div>
                <StatusBadge approved={user.is_approved} />
                <div className="flex gap-2 max-sm:w-full max-sm:pl-[3.25rem]">
                  {!user.is_approved && (
                    <button
                      type="button"
                      onClick={() => approve.mutate(user.id)}
                      disabled={approve.isPending}
                      aria-label={`${label} freigeben`}
                      className="action-primary min-h-9 px-4 text-xs max-sm:min-h-11"
                    >
                      Freigeben
                    </button>
                  )}
                  {!user.is_admin && (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(user)}
                      disabled={remove.isPending}
                      aria-label={`${label} entfernen`}
                      className="action-secondary action-danger min-h-9 px-4 text-xs max-sm:min-h-11"
                    >
                      Entfernen
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}

function InvitesCard() {
  const qc = useQueryClient();
  const [lastCode, setLastCode] = useState<string | null>(null);
  // The origin only exists in the browser; links render once hydrated.
  const origin = useSyncExternalStore(subscribeNever, () => window.location.origin, () => null);
  const { data, isLoading, isFetching, error, refetch } = useQuery<InviteInfo[]>({
    queryKey: ["admin-invites"],
    queryFn: api.adminInvites,
  });

  const create = useMutation({
    mutationFn: () => api.adminCreateInvite(),
    onSuccess: (invite) => {
      setLastCode(invite.code);
      toast.success("Einladungslink erstellt.");
      qc.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (err) => toast.error(`Einladungslink konnte nicht erstellt werden: ${errorMessage(err)}`),
  });

  function inviteUrl(code: string): string {
    if (origin === null) throw new Error("Einladungslinks können nur im Browser erzeugt werden.");
    return `${origin}/register?invite=${encodeURIComponent(code)}`;
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      toast.success("Link kopiert.");
    } catch (err) {
      toast.error(`Link konnte nicht kopiert werden: ${errorMessage(err)}`);
    }
  }

  return (
    <SettingsCard
      title="Einladungslinks"
      description="Wer sich über einen Einladungslink registriert, wird automatisch freigegeben."
      icon={<UserIcon width={18} height={18} />}
      action={
        <button type="button" onClick={() => create.mutate()} disabled={create.isPending} className="action-primary">
          {create.isPending ? "Wird erstellt…" : "Link erstellen"}
        </button>
      }
    >
      {lastCode && origin !== null && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-accent/30 bg-accent/10 p-3">
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-xs font-semibold text-accent-soft">Neuer Einladungslink</p>
            <code className="mt-1 block text-xs [overflow-wrap:anywhere]">{inviteUrl(lastCode)}</code>
          </div>
          <button type="button" onClick={() => void copy(lastCode)} className="action-secondary">
            <CopyIcon width={16} height={16} /> Kopieren
          </button>
        </div>
      )}

      {isLoading && <RowsSkeleton label="Einladungslinks werden geladen" />}
      {error && <SectionError label="Die Einladungslinks" error={error} retrying={isFetching} onRetry={() => void refetch()} />}
      {data && data.length === 0 && (
        <EmptyState icon={<CopyIcon />} title="Noch keine Einladungslinks">
          Erstelle einen Link und schicke ihn der Person, die du einladen möchtest.
        </EmptyState>
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col">
          {data.map((invite) => (
            <li
              key={invite.code}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline py-2.5 first:border-t-0 first:pt-0 last:pb-0"
            >
              <code className="min-w-0 flex-1 basis-32 text-xs [overflow-wrap:anywhere]">{invite.code}</code>
              {invite.used_by_name ? <Badge tone="neutral">Genutzt von {invite.used_by_name}</Badge> : <Badge tone="success">Frei</Badge>}
              <time dateTime={invite.created_at} className="text-xs tabular-nums text-muted">
                {new Date(invite.created_at).toLocaleDateString("de-DE")}
              </time>
              <button
                type="button"
                onClick={() => void copy(invite.code)}
                disabled={origin === null}
                aria-label={`Einladungslink ${invite.code} kopieren`}
                title="Link kopieren"
                className="action-icon h-10 min-h-10 w-10 max-sm:h-11 max-sm:w-11"
              >
                <CopyIcon width={16} height={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

/** "Benutzer & Einladungen" admin section. */
export default function UsersAndInvitesSection() {
  return (
    <div className="grid gap-4">
      <UsersCard />
      <InvitesCard />
    </div>
  );
}
