"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMe, useLogout } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/store/toast";
import type { AdminUser, StorageInfo, InviteInfo } from "@/types";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function StatusBadge({ approved }: { approved: boolean }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
        approved
          ? "bg-accent text-white"
          : "bg-panel-hover text-muted"
      }`}
    >
      {approved ? "Freigegeben" : "Wartet auf Freigabe"}
    </span>
  );
}

function AdminUsersSection() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: api.adminUsers,
  });

  const approve = useMutation({
    mutationFn: (id: string | number) => api.approveUser(id),
    onSuccess: () => {
      toast.success("Benutzer freigegeben.");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Freigabe fehlgeschlagen.",
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string | number) => api.deleteUser(id),
    onSuccess: () => {
      toast.success("Benutzer entfernt.");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Entfernen fehlgeschlagen.",
      ),
  });

  function handleDelete(u: AdminUser) {
    if (
      !window.confirm(
        `Benutzer ${u.display_name} (${u.email}) wirklich entfernen?`,
      )
    )
      return;
    remove.mutate(u.id);
  }

  return (
    <section className="bg-panel rounded-lg p-6">
      <h2 className="text-xl font-bold mb-4">Benutzerverwaltung</h2>

      {isLoading && <p className="text-muted">Lädt…</p>}
      {error && (
        <p className="text-red-400 text-sm">
          {error instanceof ApiError
            ? error.message
            : "Benutzer konnten nicht geladen werden."}
        </p>
      )}

      {data && data.length === 0 && (
        <p className="text-muted">Keine Benutzer vorhanden.</p>
      )}

      {data && data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.map((u) => (
            <li
              key={String(u.id)}
              className="flex flex-wrap items-center gap-3 bg-background rounded-md px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">
                    {u.display_name}
                  </span>
                  {u.is_admin && (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-accent text-white">
                      Admin
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted truncate">{u.email}</div>
              </div>

              <StatusBadge approved={u.is_approved} />

              <div className="flex items-center gap-2">
                {!u.is_approved && (
                  <button
                    type="button"
                    onClick={() => approve.mutate(u.id)}
                    disabled={approve.isPending}
                    className="press px-3 py-1.5 rounded-full text-sm font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    Freigeben
                  </button>
                )}
                {!u.is_admin && (
                  <button
                    type="button"
                    onClick={() => handleDelete(u)}
                    disabled={remove.isPending}
                    className="press px-3 py-1.5 rounded-full text-sm font-medium bg-panel-hover text-foreground hover:bg-white/10 disabled:opacity-50"
                  >
                    Entfernen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AdminStorageSection() {
  const { data, isLoading, error } = useQuery<StorageInfo>({
    queryKey: ["admin-storage"],
    queryFn: api.adminStorage,
  });

  return (
    <section className="bg-panel rounded-lg p-6">
      <h2 className="text-xl font-bold mb-4">Speicher</h2>

      {isLoading && <p className="text-muted">Lädt…</p>}
      {error && (
        <p className="text-red-400 text-sm">
          {error instanceof ApiError
            ? error.message
            : "Speicher konnte nicht geladen werden."}
        </p>
      )}

      {data && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="bg-background rounded-md px-4 py-3">
              <div className="text-2xl font-extrabold">{data.track_count}</div>
              <div className="text-sm text-muted">Titel</div>
            </div>
            <div className="bg-background rounded-md px-4 py-3">
              <div className="text-2xl font-extrabold">
                {formatBytes(data.total_bytes)}
              </div>
              <div className="text-sm text-muted">Gesamtgröße</div>
            </div>
          </div>

          {data.tracks.length === 0 ? (
            <p className="text-muted">Keine gespeicherten Titel.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.tracks.map((t) => (
                <li
                  key={t.deezer_id}
                  className="flex items-center gap-3 bg-background rounded-md px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{t.title}</div>
                    <div className="text-sm text-muted truncate">
                      {t.artist}
                    </div>
                  </div>
                  <span className="text-sm text-muted whitespace-nowrap">
                    {formatBytes(t.size_bytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function AdminInvitesSection() {
  const qc = useQueryClient();
  const [lastCode, setLastCode] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery<InviteInfo[]>({
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
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Erstellen fehlgeschlagen.",
      ),
  });

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";

  function inviteUrl(code: string) {
    return `${origin}/register?invite=${code}`;
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      toast.success("Link kopiert.");
    } catch {
      toast.error("Kopieren fehlgeschlagen.");
    }
  }

  return (
    <section className="bg-panel rounded-lg p-6">
      <h2 className="text-xl font-bold mb-4">Einladungslinks</h2>

      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className="press px-4 py-2 rounded-full text-sm font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-50 mb-4"
      >
        Einladungslink erstellen
      </button>

      {lastCode && (
        <div className="flex flex-wrap items-center gap-2 bg-background rounded-md px-4 py-3 mb-4">
          <code className="min-w-0 flex-1 truncate text-sm">
            {inviteUrl(lastCode)}
          </code>
          <button
            type="button"
            onClick={() => copy(lastCode)}
            className="press px-3 py-1.5 rounded-full text-sm font-medium bg-panel-hover text-foreground hover:bg-white/10"
          >
            Kopieren
          </button>
        </div>
      )}

      {isLoading && <p className="text-muted">Lädt…</p>}
      {error && (
        <p className="text-red-400 text-sm">
          {error instanceof ApiError
            ? error.message
            : "Einladungen konnten nicht geladen werden."}
        </p>
      )}

      {data && data.length === 0 && (
        <p className="text-muted">Keine Einladungslinks vorhanden.</p>
      )}

      {data && data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.map((inv) => (
            <li
              key={inv.code}
              className="flex flex-wrap items-center gap-3 bg-background rounded-md px-4 py-3"
            >
              <code className="text-sm font-medium">{inv.code}</code>
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                  inv.used_by_name
                    ? "bg-panel-hover text-muted"
                    : "bg-accent text-white"
                }`}
              >
                {inv.used_by_name || "frei"}
              </span>
              <span className="text-sm text-muted ml-auto">
                {new Date(inv.created_at).toLocaleDateString()}
              </span>
              <button
                type="button"
                onClick={() => copy(inv.code)}
                className="press px-3 py-1.5 rounded-full text-sm font-medium bg-panel-hover text-foreground hover:bg-white/10"
              >
                Kopieren
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AccountPage() {
  const { data: me, isLoading } = useMe();
  const logout = useLogout();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const uploadAvatar = useMutation({
    mutationFn: (file: File) => api.uploadAvatar(file),
    onSuccess: () => {
      toast.success("Profilbild aktualisiert.");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Upload fehlgeschlagen.",
      ),
  });

  function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) uploadAvatar.mutate(file);
  }

  if (isLoading) {
    return <p className="text-muted">Lädt…</p>;
  }

  if (!me) {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl font-extrabold mb-3">Dein Konto</h1>
        <p className="text-muted mb-4">
          Melde dich an, um dein Konto zu verwalten.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 rounded-full bg-accent text-white hover:bg-accent-hover"
        >
          Anmelden
        </Link>
      </div>
    );
  }

  const initial = (me.display_name || me.email || "?").charAt(0).toUpperCase();

  return (
    <div className="animate-in flex flex-col gap-8 max-w-3xl">
      <section className="bg-panel rounded-lg p-6 flex items-center gap-5">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          onChange={handleAvatarFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploadAvatar.isPending}
          title="Profilbild ändern"
          className="press w-20 h-20 flex-shrink-0 rounded-full overflow-hidden disabled:opacity-50"
        >
          {me.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.avatar_url}
              alt={me.display_name}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="w-full h-full bg-accent text-white flex items-center justify-center text-3xl font-extrabold">
              {initial}
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-extrabold truncate">
              {me.display_name}
            </h1>
            {me.is_admin && (
              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-accent text-white">
                Admin
              </span>
            )}
          </div>
          <p className="text-muted truncate">{me.email}</p>
          <div className="mt-2">
            <StatusBadge approved={!!me.is_approved} />
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="press self-start px-4 py-2 rounded-full text-sm font-medium bg-panel-hover text-foreground hover:bg-white/10"
        >
          Logout
        </button>
      </section>

      {me.is_admin && <AdminUsersSection />}
      {me.is_admin && <AdminStorageSection />}
      {me.is_admin && <AdminInvitesSection />}
    </div>
  );
}
