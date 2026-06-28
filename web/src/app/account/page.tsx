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
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import type {
  AdminUser,
  StorageInfo,
  InviteInfo,
  PlaybackSettings,
} from "@/types";

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
              <Avatar src={u.avatar_url} name={u.display_name} size={36} />
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
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<StorageInfo>({
    queryKey: ["admin-storage"],
    queryFn: api.adminStorage,
  });
  const cleanup = useMutation({
    mutationFn: api.adminStorageCleanup,
    onSuccess: (r) => {
      toast.success(
        r.removed
          ? `${r.removed} Titel entfernt (${formatBytes(r.freed_bytes)} frei).`
          : "Nichts zu entfernen.",
      );
      qc.invalidateQueries({ queryKey: ["admin-storage"] });
    },
    onError: () => toast.error("Aufräumen fehlgeschlagen."),
  });

  return (
    <section className="bg-panel rounded-lg p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-xl font-bold">Speicher</h2>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-xs text-muted">
              {data.retention_days > 0
                ? `Nicht gespielt seit ${data.retention_days} Tagen → automatisch gelöscht`
                : "Keine automatische Löschung"}
            </span>
          )}
          <button
            type="button"
            onClick={() => cleanup.mutate()}
            disabled={cleanup.isPending}
            className="press px-3 py-1.5 rounded-full text-sm font-medium bg-panel-hover hover:bg-white/10 disabled:opacity-50"
          >
            {cleanup.isPending ? "Räumt auf…" : "Jetzt aufräumen"}
          </button>
        </div>
      </div>

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
              <div className="text-sm text-muted">Belegt (Tracks)</div>
            </div>
            <div className="bg-background rounded-md px-4 py-3">
              <div className="text-2xl font-extrabold">
                {formatBytes(data.disk_free)}
              </div>
              <div className="text-sm text-muted">Frei auf Disk</div>
            </div>
            <div className="bg-background rounded-md px-4 py-3">
              <div className="text-2xl font-extrabold">
                {formatBytes(data.disk_total)}
              </div>
              <div className="text-sm text-muted">Disk gesamt</div>
            </div>
          </div>

          {/* Disk usage bar */}
          {data.disk_total > 0 && (
            <div className="mb-4">
              <div className="h-2 rounded-full bg-background overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{
                    width: `${Math.min(100, (data.disk_used / data.disk_total) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted mt-1">
                {formatBytes(data.disk_used)} von {formatBytes(data.disk_total)} belegt
                · {formatBytes(data.disk_free)} frei
              </p>
            </div>
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

function PlaybackSettingsSection() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<PlaybackSettings>({
    queryKey: ["playback-settings"],
    queryFn: api.settings,
  });

  const updateSettings = useMutation({
    mutationFn: (patch: Partial<PlaybackSettings>) => api.updateSettings(patch),
    onSuccess: (next) => {
      qc.setQueryData(["playback-settings"], next);
      toast.success("Wiedergabe aktualisiert.");
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Wiedergabe konnte nicht aktualisiert werden.",
      ),
  });

  const enabled = data?.crossfade_enabled ?? false;
  const duration = data?.crossfade_duration_sec ?? 5;

  return (
    <section className="bg-panel rounded-lg p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-bold">Wiedergabe</h2>
          <p className="text-sm text-muted">
            Übergänge zwischen Titeln anpassen.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-full bg-background px-3 py-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={enabled}
            disabled={isLoading || updateSettings.isPending}
            onChange={(e) =>
              updateSettings.mutate({ crossfade_enabled: e.target.checked })
            }
            className="h-4 w-4 accent-accent"
          />
          Crossfade
        </label>
      </div>

      {isLoading && <p className="text-muted">Lädt…</p>}
      {error && (
        <p className="text-red-400 text-sm">
          {error instanceof ApiError
            ? error.message
            : "Einstellungen konnten nicht geladen werden."}
        </p>
      )}

      {data && (
        <div className="rounded-lg bg-background p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">Dauer</span>
            <span className="text-sm text-muted tabular-nums">
              {duration} Sekunden
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={duration}
            disabled={!enabled || updateSettings.isPending}
            onChange={(e) =>
              updateSettings.mutate({
                crossfade_duration_sec: Number(e.target.value),
              })
            }
            aria-label="Crossfade-Dauer"
            className="w-full"
          />
          <div className="mt-2 flex justify-between text-xs text-muted">
            <span>Aus</span>
            <span>12 s</span>
          </div>
        </div>
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

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ display_name: "", email: "", password: "" });

  function openEdit() {
    setForm({
      display_name: me?.display_name ?? "",
      email: me?.email ?? "",
      password: "",
    });
    setEditing(true);
  }

  const saveProfile = useMutation({
    mutationFn: () => {
      const patch: { display_name?: string; email?: string; password?: string } = {};
      if (form.display_name && form.display_name !== me?.display_name)
        patch.display_name = form.display_name;
      if (form.email && form.email !== me?.email) patch.email = form.email;
      if (form.password) patch.password = form.password;
      return api.updateMe(patch);
    },
    onSuccess: () => {
      toast.success("Profil aktualisiert.");
      qc.invalidateQueries({ queryKey: ["me"] });
      setEditing(false);
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Speichern fehlgeschlagen.",
      ),
  });

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

  return (
    <div className="animate-in flex flex-col gap-8 w-full max-w-5xl mx-auto">
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
          className="press flex-shrink-0 rounded-full overflow-hidden disabled:opacity-50"
        >
          <Avatar src={me.avatar_url} name={me.display_name} size={80} />
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
        <div className="self-start flex flex-col gap-2">
          <button
            type="button"
            onClick={openEdit}
            className="press px-4 py-2 rounded-full text-sm font-medium bg-accent text-white hover:bg-accent-hover"
          >
            Profil bearbeiten
          </button>
          <button
            type="button"
            onClick={logout}
            className="press px-4 py-2 rounded-full text-sm font-medium bg-panel-hover text-foreground hover:bg-white/10"
          >
            Abmelden
          </button>
        </div>
      </section>

      <Modal open={editing} onClose={() => setEditing(false)} title="Profil bearbeiten">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveProfile.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            Anzeigename
            <input
              value={form.display_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, display_name: e.target.value }))
              }
              className="bg-background border border-white/15 rounded px-3 py-2 outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            E-Mail
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="bg-background border border-white/15 rounded px-3 py-2 outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Neues Passwort
            <input
              type="password"
              value={form.password}
              minLength={8}
              placeholder="Leer lassen, um beizubehalten"
              onChange={(e) =>
                setForm((f) => ({ ...f, password: e.target.value }))
              }
              className="bg-background border border-white/15 rounded px-3 py-2 outline-none focus:border-accent"
            />
          </label>
          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-4 py-2 rounded-full text-muted hover:text-foreground"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={saveProfile.isPending}
              className="press px-5 py-2 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover disabled:opacity-50"
            >
              {saveProfile.isPending ? "Speichert…" : "Speichern"}
            </button>
          </div>
        </form>
      </Modal>

      <PlaybackSettingsSection />

      {me.is_admin && (
        <Link
          href="/status"
          className="press bg-panel rounded-lg p-6 flex items-center justify-between gap-3 hover:bg-panel-hover transition"
        >
          <div>
            <h2 className="text-xl font-bold">Systemstatus</h2>
            <p className="text-sm text-muted">
              Deezer-Auth, Speicher, Benutzer & Konfiguration
            </p>
          </div>
          <span className="text-muted text-2xl">→</span>
        </Link>
      )}
      {me.is_admin && <AdminUsersSection />}
      {me.is_admin && <AdminStorageSection />}
      {me.is_admin && <AdminInvitesSection />}
    </div>
  );
}
