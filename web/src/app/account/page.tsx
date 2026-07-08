"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMe, useLogout } from "@/hooks/useAuth";
import { usePlayerStore } from "@/store/player";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/store/toast";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import ListeningStats, {
  type UserStatsWithMonth,
} from "@/components/profile/ListeningStats";
import type {
  AdminUser,
  StorageInfo,
  InviteInfo,
  PlaybackSettings,
} from "@/types";

// Sub-navigation of the account page. Keeps the profile identity always visible
// on top while the heavier content (stats, playback, admin tools) lives behind
// tabs so nothing is crammed onto one scroll.
type AccountTab = "stats" | "playback" | "admin";

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

/** Small glassy fact chip for the profile hero (plays, top artist, …). */
function HeroChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-foreground/90 backdrop-blur-sm">
      {children}
    </span>
  );
}

// Static equalizer silhouette along the hero's bottom edge — the brand glyph
// as scenery. Fixed heights (px) so the skyline is identical on every visit.
const HERO_EQ_HEIGHTS = [
  14, 30, 22, 44, 34, 56, 40, 26, 50, 36, 60, 30, 46, 20, 38, 54, 28, 42, 16,
  34, 24, 48, 18, 40, 12, 32,
];

function AdminUsersSection() {
  const qc = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
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
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Entfernen fehlgeschlagen.",
      ),
  });

  return (
    <section className="bg-panel rounded-2xl border border-white/5 p-6">
      <h2 className="text-xl font-bold mb-4">Benutzerverwaltung</h2>

      <Modal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Benutzer entfernen"
      >
        <p className="text-sm text-muted mb-4">
          {pendingDelete
            ? `${pendingDelete.display_name} (${pendingDelete.email}) wird samt Playlists, Likes und Verlauf endgültig entfernt.`
            : ""}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setPendingDelete(null)}
            className="px-4 py-2 rounded-full text-muted hover:text-foreground"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
            disabled={remove.isPending}
            className="px-5 py-2 rounded-full bg-red-500 text-white font-semibold hover:bg-red-400 disabled:opacity-60"
          >
            {remove.isPending ? "Wird entfernt…" : "Entfernen"}
          </button>
        </div>
      </Modal>

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
                    onClick={() => setPendingDelete(u)}
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
    <section className="bg-panel rounded-2xl border border-white/5 p-6">
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
    <section className="bg-panel rounded-2xl border border-white/5 p-6">
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

const SLEEP_PRESETS = [15, 30, 45, 60];

function SleepTimerSection() {
  const sleepAt = usePlayerStore((s) => s.sleepAt);
  const sleepAfterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const setSleepAfterTrack = usePlayerStore((s) => s.setSleepAfterTrack);

  // Tick once a second while armed so the remaining time counts down live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sleepAt == null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [sleepAt]);

  const remainingSec =
    sleepAt == null ? null : Math.max(0, Math.round((sleepAt - now) / 1000));
  const armed = sleepAt != null || sleepAfterTrack;

  return (
    <section className="bg-panel rounded-2xl border border-white/5 p-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold">Sleep-Timer</h2>
        <p className="text-sm text-muted">
          Pausiert die Wiedergabe nach der gewählten Zeit.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSleepTimer(null)}
          className={`press px-4 py-1.5 rounded-full text-sm font-medium transition ${
            !armed
              ? "bg-foreground text-background"
              : "bg-background text-muted hover:text-foreground"
          }`}
        >
          Aus
        </button>
        {SLEEP_PRESETS.map((m) => {
          // Active when this preset was picked (remaining time still within it).
          const active =
            remainingSec != null &&
            remainingSec > (SLEEP_PRESETS[SLEEP_PRESETS.indexOf(m) - 1] ?? 0) * 60 &&
            remainingSec <= m * 60;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setSleepTimer(m)}
              className={`press px-4 py-1.5 rounded-full text-sm font-medium transition ${
                active
                  ? "bg-accent text-white"
                  : "bg-background text-muted hover:text-foreground"
              }`}
            >
              {m} min
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setSleepAfterTrack(true)}
          className={`press px-4 py-1.5 rounded-full text-sm font-medium transition ${
            sleepAfterTrack
              ? "bg-accent text-white"
              : "bg-background text-muted hover:text-foreground"
          }`}
        >
          Ende des Titels
        </button>
      </div>
      {remainingSec != null && (
        <p className="mt-3 text-sm text-muted tabular-nums">
          Pausiert in {Math.floor(remainingSec / 60)}:
          {String(remainingSec % 60).padStart(2, "0")} Minuten.
        </p>
      )}
      {sleepAfterTrack && (
        <p className="mt-3 text-sm text-muted">
          Pausiert, sobald der aktuelle Titel zu Ende ist.
        </p>
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
    <section className="bg-panel rounded-2xl border border-white/5 p-6">
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

  // Same cache entry ListeningStats uses — the hero shows a few headline
  // numbers, the stats tab the full breakdown.
  const { data: stats } = useQuery<UserStatsWithMonth>({
    queryKey: ["stats"],
    queryFn: api.stats,
    enabled: !!me,
  });

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [form, setForm] = useState({ display_name: "", email: "", password: "" });
  const [tab, setTab] = useState<AccountTab>("stats");

  const deleteAccount = useMutation({
    mutationFn: () => api.deleteMe(),
    onSuccess: () => {
      toast.success("Konto gelöscht.");
      qc.clear();
      window.location.href = "/";
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Löschen fehlgeschlagen.",
      ),
  });

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

  const TABS: { key: AccountTab; label: string }[] = [
    { key: "stats", label: "Statistiken" },
    { key: "playback", label: "Wiedergabe" },
    ...(me.is_admin
      ? [{ key: "admin" as const, label: "Administration" }]
      : []),
  ];

  return (
    <div className="animate-in flex flex-col gap-8 w-full max-w-5xl mx-auto">
      <section className="relative overflow-hidden rounded-2xl border border-white/10">
        {/* Layered brand backdrop: panel base, violet wash, two soft glows. */}
        <div className="absolute inset-0 bg-panel" />
        <div className="absolute inset-0 gradient-violet opacity-20" />
        <div
          className="absolute -top-24 -right-16 h-80 w-80 rounded-full opacity-15 blur-3xl"
          style={{ background: "var(--grad-pink-from)" }}
        />
        <div
          className="absolute -top-20 left-1/4 h-72 w-72 rounded-full opacity-25 blur-3xl"
          style={{ background: "var(--accent)" }}
        />
        {/* Equalizer skyline along the bottom edge — the brand glyph as scenery. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 flex items-end gap-[3px] px-4"
        >
          {HERO_EQ_HEIGHTS.map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-sm bg-white/[0.05]"
              style={{ height: `${h}px` }}
            />
          ))}
        </div>

        <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
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
            className="press group relative flex-shrink-0 self-center rounded-full disabled:opacity-50 sm:self-auto"
          >
            <span className="block overflow-hidden rounded-full ring-2 ring-accent/60 glow-sm">
              <Avatar src={me.avatar_url} name={me.display_name} size={96} />
            </span>
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 text-xs font-semibold opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
              Ändern
            </span>
          </button>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="flex items-center justify-center gap-2 flex-wrap sm:justify-start">
              <h1 className="truncate text-3xl font-extrabold tracking-tight sm:text-4xl">
                {me.display_name}
              </h1>
              {me.is_admin && (
                <span className="inline-block rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white">
                  Admin
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-muted">{me.email}</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <StatusBadge approved={!!me.is_approved} />
              {stats && stats.total_plays > 0 && (
                <HeroChip>
                  <b className="font-semibold tabular-nums">
                    {stats.total_plays}
                  </b>{" "}
                  Wiedergaben
                </HeroChip>
              )}
              {(stats?.total_plays_month ?? 0) > 0 && (
                <HeroChip>
                  <b className="font-semibold tabular-nums">
                    {stats!.total_plays_month}
                  </b>{" "}
                  in 30 Tagen
                </HeroChip>
              )}
              {stats?.top_artists[0] && (
                <HeroChip>Top: {stats.top_artists[0].label}</HeroChip>
              )}
            </div>
          </div>

          <div className="flex flex-row justify-center gap-2 sm:flex-col sm:self-start">
            <button
              type="button"
              onClick={openEdit}
              className="press rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Profil bearbeiten
            </button>
            <button
              type="button"
              onClick={logout}
              className="press rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-foreground backdrop-blur-sm hover:bg-white/15"
            >
              Abmelden
            </button>
          </div>
        </div>
      </section>

      <Modal
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Konto löschen"
      >
        <p className="text-sm text-muted mb-4">
          Dein Konto wird mit allen Playlists, Likes und deinem Hörverlauf
          endgültig gelöscht. Das kann nicht rückgängig gemacht werden.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="px-4 py-2 rounded-full text-muted hover:text-foreground"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => deleteAccount.mutate()}
            disabled={deleteAccount.isPending}
            className="px-5 py-2 rounded-full bg-red-500 text-white font-semibold hover:bg-red-400 disabled:opacity-60"
          >
            {deleteAccount.isPending ? "Wird gelöscht…" : "Endgültig löschen"}
          </button>
        </div>
      </Modal>

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

      {/* Sub-navigation: one segmented pill control */}
      <div className="-mb-2 self-center sm:self-start">
        <div className="inline-flex flex-wrap gap-1 rounded-full border border-white/5 bg-panel p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`press rounded-full px-4 py-1.5 text-sm font-medium transition ${
                tab === t.key
                  ? "bg-accent text-white glow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "stats" && <ListeningStats />}

      {tab === "playback" && (
        <div className="flex flex-col gap-8">
          <PlaybackSettingsSection />
          <SleepTimerSection />
        </div>
      )}

      {tab === "admin" && me.is_admin && (
        <div className="flex flex-col gap-8">
          <Link
            href="/status"
            className="press bg-panel rounded-2xl border border-white/5 p-6 flex items-center justify-between gap-3 hover:bg-panel-hover transition"
          >
            <div>
              <h2 className="text-xl font-bold">Systemstatus</h2>
              <p className="text-sm text-muted">
                Deezer-Auth, Speicher, Benutzer & Konfiguration
              </p>
            </div>
            <span className="text-muted text-2xl">→</span>
          </Link>
          <AdminUsersSection />
          <AdminStorageSection />
          <AdminInvitesSection />
        </div>
      )}

      {/* Destructive action lives quietly at the very end, not in the hero. */}
      <div className="flex justify-center border-t border-white/5 pt-4 sm:justify-end">
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="press rounded-full px-4 py-2 text-sm font-medium text-red-400/90 hover:bg-red-500/10"
        >
          Konto löschen
        </button>
      </div>
    </div>
  );
}
