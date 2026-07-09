"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMe, useLogout } from "@/hooks/useAuth";
import { currentTrack, usePlayerStore } from "@/store/player";
import { useBassGlow } from "@/hooks/useBassGlow";
import { useCoverColors } from "@/hooks/useCoverColors";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/store/toast";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import { RadialVisualizer } from "@/components/Visualizer";
import {
  ChevronRightIcon,
  ClockIcon,
  EditIcon,
  StatusIcon,
  UserIcon,
  VisualizerIcon,
} from "@/components/icons";
import ListeningStats, {
  type UserStatsWithMonth,
} from "@/components/profile/ListeningStats";
import type {
  AdminUser,
  StorageInfo,
  InviteInfo,
  PlaybackSettings,
} from "@/types";
import styles from "./account.module.css";

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

function formatCount(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

function StatusBadge({ approved }: { approved: boolean }) {
  return (
    <span
      className={`${styles.statusBadge} ${
        approved ? styles.statusApproved : styles.statusPending
      }`}
    >
      <span className={styles.statusDot} aria-hidden />
      {approved ? "Freigegeben" : "Wartet auf Freigabe"}
    </span>
  );
}

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
    <section className={styles.panelCard}>
      <div className={styles.sectionHeading}>
        <span className={styles.sectionIcon} aria-hidden>
          <UserIcon />
        </span>
        <div>
          <span className={styles.panelKicker}>Community</span>
          <h2>Benutzerverwaltung</h2>
        </div>
      </div>

      <Modal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Benutzer entfernen"
      >
        <p className={styles.modalCopy}>
          {pendingDelete
            ? `${pendingDelete.display_name} (${pendingDelete.email}) wird samt Playlists, Likes und Verlauf endgültig entfernt.`
            : ""}
        </p>
        <div className={styles.modalActions}>
          <button
            type="button"
            onClick={() => setPendingDelete(null)}
            className={styles.ghostButton}
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
            disabled={remove.isPending}
            className={styles.dangerButton}
          >
            {remove.isPending ? "Wird entfernt…" : "Entfernen"}
          </button>
        </div>
      </Modal>

      {isLoading && <p className={styles.stateMessage}>Lädt…</p>}
      {error && (
        <p className={styles.errorMessage}>
          {error instanceof ApiError
            ? error.message
            : "Benutzer konnten nicht geladen werden."}
        </p>
      )}

      {data && data.length === 0 && (
        <p className={styles.stateMessage}>Keine Benutzer vorhanden.</p>
      )}

      {data && data.length > 0 && (
        <ul className={styles.userList}>
          {data.map((u) => (
            <li
              key={String(u.id)}
              className={styles.userRow}
            >
              <Avatar src={u.avatar_url} name={u.display_name} size={36} />
              <div className={styles.userIdentity}>
                <div className={styles.userNameLine}>
                  <span className={styles.userName}>
                    {u.display_name}
                  </span>
                  {u.is_admin && (
                    <span className={styles.adminBadge}>
                      Admin
                    </span>
                  )}
                </div>
                <div className={styles.userEmail}>{u.email}</div>
              </div>

              <StatusBadge approved={u.is_approved} />

              <div className={styles.rowActions}>
                {!u.is_approved && (
                  <button
                    type="button"
                    onClick={() => approve.mutate(u.id)}
                    disabled={approve.isPending}
                    className={styles.primarySmallButton}
                  >
                    Freigeben
                  </button>
                )}
                {!u.is_admin && (
                  <button
                    type="button"
                    onClick={() => setPendingDelete(u)}
                    disabled={remove.isPending}
                    className={styles.secondarySmallButton}
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
    <section className={styles.panelCard}>
      <div className={styles.panelHeaderRow}>
        <div className={styles.sectionHeading}>
          <span className={styles.sectionIcon} aria-hidden>
            <StatusIcon />
          </span>
          <div>
            <span className={styles.panelKicker}>System</span>
            <h2>Speicher</h2>
          </div>
        </div>
        <div className={styles.panelHeaderActions}>
          {data && (
            <span className={styles.retentionNote}>
              {data.retention_days > 0
                ? `Nicht gespielt seit ${data.retention_days} Tagen → automatisch gelöscht`
                : "Keine automatische Löschung"}
            </span>
          )}
          <button
            type="button"
            onClick={() => cleanup.mutate()}
            disabled={cleanup.isPending}
            className={styles.secondarySmallButton}
          >
            {cleanup.isPending ? "Räumt auf…" : "Jetzt aufräumen"}
          </button>
        </div>
      </div>

      {isLoading && <p className={styles.stateMessage}>Lädt…</p>}
      {error && (
        <p className={styles.errorMessage}>
          {error instanceof ApiError
            ? error.message
            : "Speicher konnte nicht geladen werden."}
        </p>
      )}

      {data && (
        <>
          <div className={styles.storageGrid}>
            <div className={styles.storageMetric}>
              <div className={styles.storageValue}>{data.track_count}</div>
              <div className={styles.storageLabel}>Titel</div>
            </div>
            <div className={styles.storageMetric}>
              <div className={styles.storageValue}>
                {formatBytes(data.total_bytes)}
              </div>
              <div className={styles.storageLabel}>Belegt (Tracks)</div>
            </div>
            <div className={styles.storageMetric}>
              <div className={styles.storageValue}>
                {formatBytes(data.disk_free)}
              </div>
              <div className={styles.storageLabel}>Frei auf Disk</div>
            </div>
            <div className={styles.storageMetric}>
              <div className={styles.storageValue}>
                {formatBytes(data.disk_total)}
              </div>
              <div className={styles.storageLabel}>Disk gesamt</div>
            </div>
          </div>

          {/* Disk usage bar */}
          {data.disk_total > 0 && (
            <div className={styles.storageProgressBlock}>
              <div className={styles.storageProgressTrack}>
                <div
                  className={styles.storageProgressFill}
                  style={{
                    width: `${Math.min(100, (data.disk_used / data.disk_total) * 100)}%`,
                  }}
                />
              </div>
              <p className={styles.storageProgressLabel}>
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
    <section className={styles.panelCard}>
      <div className={styles.sectionHeading}>
        <span className={styles.sectionIcon} aria-hidden>
          <UserIcon />
        </span>
        <div>
          <span className={styles.panelKicker}>Zugang</span>
          <h2>Einladungslinks</h2>
        </div>
      </div>

      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className={styles.primaryButton}
      >
        Einladungslink erstellen
      </button>

      {lastCode && (
        <div className={styles.inviteReveal}>
          <code className={styles.inviteCodeWide}>
            {inviteUrl(lastCode)}
          </code>
          <button
            type="button"
            onClick={() => copy(lastCode)}
            className={styles.secondarySmallButton}
          >
            Kopieren
          </button>
        </div>
      )}

      {isLoading && <p className={styles.stateMessage}>Lädt…</p>}
      {error && (
        <p className={styles.errorMessage}>
          {error instanceof ApiError
            ? error.message
            : "Einladungen konnten nicht geladen werden."}
        </p>
      )}

      {data && data.length === 0 && (
        <p className={styles.stateMessage}>Keine Einladungslinks vorhanden.</p>
      )}

      {data && data.length > 0 && (
        <ul className={styles.inviteList}>
          {data.map((inv) => (
            <li
              key={inv.code}
              className={styles.inviteRow}
            >
              <code className={styles.inviteCode}>{inv.code}</code>
              <span
                className={`${styles.inviteState} ${
                  inv.used_by_name
                    ? styles.inviteUsed
                    : styles.inviteFree
                }`}
              >
                {inv.used_by_name || "frei"}
              </span>
              <span className={styles.inviteDate}>
                {new Date(inv.created_at).toLocaleDateString()}
              </span>
              <button
                type="button"
                onClick={() => copy(inv.code)}
                className={styles.secondarySmallButton}
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
    <section className={`${styles.panelCard} ${styles.sleepCard}`}>
      <div className={styles.sleepContent}>
        <div>
          <div className={styles.sectionHeading}>
            <span className={styles.sectionIcon} aria-hidden>
              <ClockIcon />
            </span>
            <div>
              <span className={styles.panelKicker}>Nachtmodus</span>
              <h2>Sleep-Timer</h2>
            </div>
          </div>
          <p className={styles.sectionDescription}>
            Lass die Musik ausklingen. Wir pausieren automatisch, wenn du es
            möchtest.
          </p>

          <div className={styles.presetGrid} aria-label="Sleep-Timer auswählen">
            <button
              type="button"
              onClick={() => setSleepTimer(null)}
              aria-pressed={!armed}
              className={`${styles.presetButton} ${
                !armed ? styles.presetActive : ""
              }`}
            >
              Aus
            </button>
            {SLEEP_PRESETS.map((m) => {
              const previous = SLEEP_PRESETS[SLEEP_PRESETS.indexOf(m) - 1] ?? 0;
              const active =
                remainingSec != null &&
                remainingSec > previous * 60 &&
                remainingSec <= m * 60;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSleepTimer(m)}
                  aria-pressed={active}
                  className={`${styles.presetButton} ${
                    active ? styles.presetActive : ""
                  }`}
                >
                  <strong>{m}</strong>
                  <span>min</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSleepAfterTrack(true)}
              aria-pressed={sleepAfterTrack}
              className={`${styles.presetButton} ${styles.presetTrackEnd} ${
                sleepAfterTrack ? styles.presetActive : ""
              }`}
            >
              Ende des Titels
            </button>
          </div>
        </div>

        <div className={styles.timerDial} data-armed={armed} aria-live="polite">
          <span className={styles.timerOrbit} aria-hidden />
          <span className={styles.timerOrbitDot} aria-hidden />
          <ClockIcon className={styles.timerIcon} />
          {remainingSec != null ? (
            <>
              <strong>
                {Math.floor(remainingSec / 60)}:
                {String(remainingSec % 60).padStart(2, "0")}
              </strong>
              <span>bis zur Ruhe</span>
            </>
          ) : sleepAfterTrack ? (
            <>
              <strong>Outro</strong>
              <span>nach diesem Titel</span>
            </>
          ) : (
            <>
              <strong>∞</strong>
              <span>läuft weiter</span>
            </>
          )}
        </div>
      </div>
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
    <section className={`${styles.panelCard} ${styles.playbackCard}`}>
      <div className={styles.panelHeaderRow}>
        <div className={styles.sectionHeading}>
          <span className={styles.sectionIcon} aria-hidden>
            <VisualizerIcon />
          </span>
          <div>
            <span className={styles.panelKicker}>Übergangsmotor</span>
            <h2>Crossfade</h2>
          </div>
        </div>

        <label className={styles.switchLabel}>
          <span>{enabled ? "Aktiv" : "Aus"}</span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={isLoading || updateSettings.isPending}
            onChange={(e) =>
              updateSettings.mutate({ crossfade_enabled: e.target.checked })
            }
            className={styles.switchInput}
          />
          <span className={styles.switchTrack} aria-hidden>
            <span className={styles.switchThumb} />
          </span>
        </label>
      </div>

      <p className={styles.sectionDescription}>
        Zwei Titel, ein Moment. Bestimme, wie weich der nächste Song in den
        laufenden gleitet.
      </p>

      {isLoading && <p className={styles.stateMessage}>Lädt…</p>}
      {error && (
        <p className={styles.errorMessage}>
          {error instanceof ApiError
            ? error.message
            : "Einstellungen konnten nicht geladen werden."}
        </p>
      )}

      {data && (
        <div className={styles.crossfadeControl} data-enabled={enabled}>
          <div className={styles.crossfadeVisual} aria-hidden>
            <div className={`${styles.waveform} ${styles.waveformOutgoing}`}>
              {[24, 52, 38, 78, 46, 86, 60, 34, 68, 48, 28, 58].map(
                (height, index) => (
                  <span key={index} style={{ height: `${height}%` }} />
                ),
              )}
            </div>
            <div className={styles.fadeLens}>
              <strong>{duration}</strong>
              <span>Sek.</span>
            </div>
            <div className={`${styles.waveform} ${styles.waveformIncoming}`}>
              {[58, 30, 72, 42, 88, 62, 36, 80, 48, 68, 40, 54].map(
                (height, index) => (
                  <span key={index} style={{ height: `${height}%` }} />
                ),
              )}
            </div>
            <span className={styles.trackLabelLeft}>Jetzt</span>
            <span className={styles.trackLabelRight}>Danach</span>
          </div>

          <div className={styles.rangeBlock}>
            <div className={styles.rangeLabels}>
              <span>Crossfade-Dauer</span>
              <span>{duration} Sekunden</span>
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
              className={styles.crossfadeRange}
              style={{ "--range-value": `${(duration / 12) * 100}%` } as React.CSSProperties}
            />
            <div className={styles.rangeScale}>
              <span>Direkt</span>
              <span>12 s</span>
            </div>
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const liveTrack = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);

  // Same cache entry ListeningStats uses — the hero shows a few headline
  // numbers, the stats tab the full breakdown.
  const { data: stats } = useQuery<UserStatsWithMonth>({
    queryKey: ["stats"],
    queryFn: api.stats,
    enabled: !!me,
  });
  const signalTrack = liveTrack ?? stats?.recent[0] ?? null;
  const profileCover = signalTrack?.cover ?? null;
  const palette = useCoverColors(profileCover);
  const avatarGlowRef = useBassGlow<HTMLDivElement>(isPlaying, {
    color: palette?.rgb,
    baseSpread: 18,
    peakSpread: 34,
    baseAlpha: 0.28,
    peakAlpha: 0.52,
    maxScale: 0.012,
    tintBorder: true,
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
    return (
      <div className={styles.loadingState} role="status">
        <span className={styles.loadingOrb} aria-hidden />
        <div>
          <span className={styles.panelKicker}>Sonic Passport</span>
          <p>Dein Klangprofil wird geladen…</p>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <section className={styles.signedOutState}>
        <span className={styles.signedOutOrb} aria-hidden>
          <UserIcon />
        </span>
        <span className={styles.panelKicker}>Privater Bereich</span>
        <h1>Dein Klangprofil wartet.</h1>
        <p>Melde dich an, um dein Konto und deine Hörsignatur zu verwalten.</p>
        <Link
          href="/login"
          className={styles.primaryButton}
        >
          Anmelden
        </Link>
      </section>
    );
  }

  const TABS: {
    key: AccountTab;
    label: string;
    description: string;
    icon: React.ReactNode;
  }[] = [
    {
      key: "stats",
      label: "Hörprofil",
      description: "Deine Listening DNA",
      icon: <VisualizerIcon />,
    },
    {
      key: "playback",
      label: "Wiedergabe",
      description: "Übergänge & Ruhemodus",
      icon: <ClockIcon />,
    },
    ...(me.is_admin
      ? [
          {
            key: "admin" as const,
            label: "Studio",
            description: "System & Community",
            icon: <StatusIcon />,
          },
        ]
      : []),
  ];

  const profileStyle = {
    "--profile-primary": palette?.primary ?? "rgb(124, 92, 255)",
    "--profile-secondary": palette?.secondary ?? "rgb(255, 110, 199)",
  } as React.CSSProperties;
  const sonicId = String(me.id)
    .replace(/[^a-z0-9]/gi, "")
    .slice(-8)
    .toUpperCase();

  function handleHeroPointerMove(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--spotlight-x",
      `${((event.clientX - rect.left) / rect.width) * 100}%`,
    );
    event.currentTarget.style.setProperty(
      "--spotlight-y",
      `${((event.clientY - rect.top) / rect.height) * 100}%`,
    );
  }

  function handleTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + direction + TABS.length) % TABS.length;
    setTab(TABS[nextIndex].key);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className={styles.page} style={profileStyle}>
      <section
        className={styles.hero}
        onPointerMove={handleHeroPointerMove}
        onPointerLeave={(event) => {
          event.currentTarget.style.setProperty("--spotlight-x", "72%");
          event.currentTarget.style.setProperty("--spotlight-y", "24%");
        }}
      >
        <div className={styles.heroNoise} aria-hidden />
        <div className={styles.heroHalo} aria-hidden />
        <div className={styles.heroScanline} aria-hidden />

        <div className={styles.heroTopline}>
          <span className={styles.liveLabel}>
            <span className={styles.liveDot} aria-hidden />
            {isPlaying ? "Live signal" : "Sonic passport"}
          </span>
          <span className={styles.passportId}>LR / {sonicId} / PROFILE</span>
        </div>

        <div className={styles.heroGrid}>
          <div className={styles.identityColumn}>
            <div className={styles.identityCopy}>
              <span className={styles.heroEyebrow}>Deine persönliche Frequenz</span>
              <h1>
                <span>{me.display_name}</span>
                <em>klingt so.</em>
              </h1>
              <p className={styles.heroIntro}>
                Jeder Play hinterlässt eine Spur. Hier wird daraus dein ganz
                persönliches Klangbild.
              </p>
              <div className={styles.identityMeta}>
                <StatusBadge approved={!!me.is_approved} />
                {me.is_admin && <span className={styles.adminBadge}>Admin</span>}
                <span className={styles.email}>{me.email}</span>
              </div>
            </div>

            <div className={styles.heroActions}>
              <button
                type="button"
                onClick={openEdit}
                className={styles.primaryButton}
              >
                <EditIcon />
                Profil bearbeiten
              </button>
              <button type="button" onClick={logout} className={styles.ghostButton}>
                Abmelden
                <ChevronRightIcon />
              </button>
            </div>

            <div className={styles.heroMetrics}>
              <article className={styles.heroMetric}>
                <span>01 · All time</span>
                <strong>{stats ? formatCount(stats.total_plays) : "…"}</strong>
                <small>Wiedergaben</small>
              </article>
              <article className={styles.heroMetric}>
                <span>02 · 30 Tage</span>
                <strong>
                  {stats ? formatCount(stats.total_plays_month ?? 0) : "…"}
                </strong>
                <small>neue Impulse</small>
              </article>
              <article className={`${styles.heroMetric} ${styles.heroMetricWide}`}>
                <span>03 · Top Artist</span>
                <strong>
                  {stats ? stats.top_artists[0]?.label ?? "Noch unentdeckt" : "…"}
                </strong>
                <small>dein stärkstes Signal</small>
              </article>
            </div>
          </div>

          <div className={styles.orbitColumn}>
            <div className={styles.orbitStage}>
              <span className={styles.orbitRingOuter} aria-hidden />
              <span className={styles.orbitRingInner} aria-hidden />
              <span className={styles.orbitSatellite} aria-hidden />
              <RadialVisualizer
                isPlaying={isPlaying}
                className={styles.radialVisualizer}
              />

              <div ref={avatarGlowRef} className={styles.avatarGlowShell}>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={handleAvatarFile}
                  className={styles.fileInput}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploadAvatar.isPending}
                  aria-label="Profilbild ändern"
                  className={styles.avatarButton}
                >
                  <Avatar
                    src={me.avatar_url}
                    name={me.display_name}
                    size={168}
                    className={styles.avatarImage}
                  />
                  <span className={styles.avatarEdit}>
                    <EditIcon />
                    {uploadAvatar.isPending ? "Upload…" : "Bild ändern"}
                  </span>
                </button>
              </div>

              <span className={`${styles.coordinate} ${styles.coordinateTop}`}>
                48° 08′ N
              </span>
              <span className={`${styles.coordinate} ${styles.coordinateSide}`}>
                FREQ · LR
              </span>
            </div>

            <div className={styles.signalCard}>
              {signalTrack?.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={signalTrack.cover} alt="" />
              ) : (
                <span className={styles.signalPlaceholder} aria-hidden>
                  <VisualizerIcon />
                </span>
              )}
              <div className={styles.signalCopy}>
                <span>
                  <i className={isPlaying ? styles.signalPulse : ""} aria-hidden />
                  {isPlaying && liveTrack ? "Jetzt läuft" : "Letzter Impuls"}
                </span>
                <strong>{signalTrack?.title ?? "Noch kein Titel"}</strong>
                <small>{signalTrack?.artist ?? "Starte deine erste Wiedergabe"}</small>
              </div>
              <span className={styles.signalBars} aria-hidden>
                {[42, 78, 56, 92, 64].map((height, index) => (
                  <i key={index} style={{ height: `${height}%` }} />
                ))}
              </span>
            </div>
          </div>
        </div>
      </section>

      <Modal
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Konto löschen"
      >
        <p className={styles.modalCopy}>
          Dein Konto wird mit allen Playlists, Likes und deinem Hörverlauf
          endgültig gelöscht. Das kann nicht rückgängig gemacht werden.
        </p>
        <div className={styles.modalActions}>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className={styles.ghostButton}
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => deleteAccount.mutate()}
            disabled={deleteAccount.isPending}
            className={styles.dangerButton}
          >
            {deleteAccount.isPending ? "Wird gelöscht…" : "Endgültig löschen"}
          </button>
        </div>
      </Modal>

      <Modal open={editing} onClose={() => setEditing(false)} title="Profil bearbeiten">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveProfile.mutate();
          }}
          className={styles.profileForm}
        >
          <label className={styles.fieldLabel}>
            <span>Anzeigename</span>
            <input
              value={form.display_name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  display_name: event.target.value,
                }))
              }
              className={styles.fieldInput}
            />
          </label>
          <label className={styles.fieldLabel}>
            <span>E-Mail</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({ ...current, email: event.target.value }))
              }
              className={styles.fieldInput}
            />
          </label>
          <label className={styles.fieldLabel}>
            <span>Neues Passwort</span>
            <input
              type="password"
              value={form.password}
              minLength={8}
              placeholder="Leer lassen, um beizubehalten"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              className={styles.fieldInput}
            />
          </label>
          <div className={styles.modalActions}>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={styles.ghostButton}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={saveProfile.isPending}
              className={styles.primaryButton}
            >
              {saveProfile.isPending ? "Speichert…" : "Speichern"}
            </button>
          </div>
        </form>
      </Modal>

      <nav className={styles.tabNav} aria-label="Kontobereiche">
        <div className={styles.tabList} role="tablist" aria-label="Kontobereiche">
          {TABS.map((item, index) => (
            <button
              key={item.key}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`account-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              aria-controls={`account-panel-${item.key}`}
              tabIndex={tab === item.key ? 0 : -1}
              onClick={() => setTab(item.key)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={`${styles.tabButton} ${
                tab === item.key ? styles.tabButtonActive : ""
              }`}
            >
              <span className={styles.tabIcon}>{item.icon}</span>
              <span className={styles.tabCopy}>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <span className={styles.tabIndex}>0{index + 1}</span>
            </button>
          ))}
        </div>
      </nav>

      <section
        id={`account-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`account-tab-${tab}`}
        className={styles.tabPanel}
      >
        <div key={tab} className={styles.tabContent}>
          {tab === "stats" && <ListeningStats />}

          {tab === "playback" && (
            <div className={styles.settingsGrid}>
              <PlaybackSettingsSection />
              <SleepTimerSection />
            </div>
          )}

          {tab === "admin" && me.is_admin && (
            <div className={styles.adminStack}>
              <Link href="/status" className={styles.statusLink}>
                <span className={styles.statusLinkIcon} aria-hidden>
                  <StatusIcon />
                </span>
                <span className={styles.statusLinkCopy}>
                  <small>Live-Diagnose</small>
                  <strong>Systemstatus</strong>
                  <span>Deezer-Auth, Speicher, Benutzer & Konfiguration</span>
                </span>
                <ChevronRightIcon className={styles.statusLinkArrow} />
              </Link>
              <AdminUsersSection />
              <AdminStorageSection />
              <AdminInvitesSection />
            </div>
          )}
        </div>
      </section>

      <div className={styles.dangerZone}>
        <div>
          <span className={styles.panelKicker}>Privatsphäre</span>
          <p>Du möchtest LoggeRythm nicht mehr verwenden?</p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className={styles.dangerTextButton}
        >
          Konto löschen
        </button>
      </div>
    </div>
  );
}
