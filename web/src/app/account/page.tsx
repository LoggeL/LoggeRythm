"use client";

import Link from "next/link";
import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe, useLogout } from "@/hooks/useAuth";
import { currentTrack, usePlayerStore } from "@/store/player";
import { api } from "@/lib/api";
import { decodeListeningStats } from "@/lib/listeningStats";
import { toast } from "@/store/toast";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import { ChevronRightIcon, ClockIcon, EditIcon, StatusIcon, UserIcon, VisualizerIcon } from "@/components/icons";
import ListeningStats from "@/components/profile/ListeningStats";
import type { UserStats } from "@/types";
import { AdminUsersSection, AdminStorageSection, AdminInvitesSection } from "./Administration";
import { PlaybackSettingsSection, SleepTimerSection } from "./PlaybackSettings";
import { formatCount, StatusBadge } from "./presentation";
import styles from "./account.module.css";

type AccountTab = "stats" | "playback" | "admin";

function AccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: me, isLoading, error: meError, refetch: refreshMe, isFetching: meFetching } = useMe();
  const logout = useLogout();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const liveTrack = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);

  // Share the validated query with the detailed listening statistics.
  const { data: stats, error: statsError } = useQuery<UserStats>({
    queryKey: ["stats"],
    queryFn: async () => decodeListeningStats(await api.stats()),
    enabled: !!me,
  });
  const signalTrack = liveTrack ?? stats?.recent[0] ?? null;
  const uploadAvatar = useMutation({
    mutationFn: (file: File) => api.uploadAvatar(file),
    onSuccess: () => {
      toast.success("Profilbild aktualisiert.");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Upload fehlgeschlagen.",
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
  const requestedTab = searchParams.get("tab");
  const tab: AccountTab = requestedTab === "playback" ? "playback" : requestedTab === "admin" && me?.is_admin ? "admin" : "stats";
  function selectTab(next: AccountTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`/account?${params.toString()}`, { scroll: false });
  }

  const signOut = useMutation({
    mutationFn: logout,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Abmelden fehlgeschlagen."),
  });

  const deleteAccount = useMutation({
    mutationFn: () => api.deleteMe(),
    onSuccess: () => {
      toast.success("Konto gelöscht.");
      qc.clear();
      // Reload the document to dispose playback and in-memory account state.
      window.location.replace(new URL("/", window.location.origin).href);
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Löschen fehlgeschlagen.",
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
      if (!me) throw new Error("Das Profil ist nicht geladen. Lade dein Konto erneut.");
      const displayName = form.display_name.trim();
      const email = form.email.trim();
      if (!email) throw new Error("Die E-Mail darf nicht leer sein.");
      const patch: { display_name?: string; email?: string; password?: string } = {};
      if (displayName !== (me.display_name ?? "")) patch.display_name = displayName;
      if (email !== me.email) patch.email = email;
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
        err instanceof Error ? err.message : "Speichern fehlgeschlagen.",
      ),
  });

  if (isLoading) {
    return (
      <div className={styles.loadingState} role="status">
        <span className={styles.loadingOrb} aria-hidden />
        <div>
          <span className={styles.panelKicker}>Konto</span>
          <p>Dein Profil wird geladen…</p>
        </div>
      </div>
    );
  }

  if (meError && !me) {
    return (
      <section className="error-panel" role="alert">
        <h1 className="page-title">Konto konnte nicht geladen werden</h1>
        <p>{meError.message}</p>
        <button type="button" onClick={() => refreshMe()} disabled={meFetching} className="action-secondary">
          {meFetching ? "Wird aktualisiert…" : "Erneut versuchen"}
        </button>
      </section>
    );
  }

  if (!me) {
    return (
      <section className={styles.signedOutState}>
        <span className={styles.signedOutOrb} aria-hidden>
          <UserIcon />
        </span>
        <span className={styles.panelKicker}>Privater Bereich</span>
        <h1>Dein Konto</h1>
        <p>Melde dich an, um dein Profil, deinen Hörverlauf und deine Einstellungen zu öffnen.</p>
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
      description: "Verlauf & Statistiken",
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
            label: "Verwaltung",
            description: "Benutzer & System",
            icon: <StatusIcon />,
          },
        ]
      : []),
  ];

  function handleTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    selectTab(TABS[nextIndex].key);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className={styles.page}>
      <header className="page-header">
        <div>
          <span className="page-eyebrow">Dein Bereich</span>
          <h1 className="page-title">Konto</h1>
          <p className="page-description">Profil, Hörverlauf und Wiedergabe an einem Ort.</p>
        </div>
      </header>

      {meError && (
        <div className="error-panel" role="alert">
          <p>{meError.message}</p>
          <button type="button" onClick={() => refreshMe()} disabled={meFetching} className="action-secondary">
            {meFetching ? "Wird aktualisiert…" : "Profil erneut laden"}
          </button>
        </div>
      )}

      <section className={styles.profileCard} aria-label="Dein Profil">
        <div className={styles.profileIdentity}>
          <input ref={fileInput} type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={handleAvatarFile} className={styles.fileInput} />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={uploadAvatar.isPending} aria-label="Profilbild ändern" className={styles.avatarButton}>
            <Avatar src={me.avatar_url} name={me.display_name} size={80} className={styles.avatarImage} />
            <span className={styles.avatarEdit}><EditIcon /></span>
          </button>
          <div className={styles.profileCopy}>
            <h2>{me.display_name}</h2>
            <p className={styles.email}>{me.email}</p>
            <div className={styles.identityMeta}>
              <StatusBadge approved={!!me.is_approved} />
              {me.is_admin && <span className={styles.adminBadge}>Admin</span>}
              {uploadAvatar.isPending && <span role="status">Profilbild wird hochgeladen…</span>}
            </div>
          </div>
          <div className={styles.profileActions}>
            <button type="button" onClick={openEdit} className="action-primary"><EditIcon /> Profil bearbeiten</button>
            <button type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending} className="action-secondary">
              {signOut.isPending ? "Wird abgemeldet…" : "Abmelden"}
            </button>
          </div>
        </div>

        {statsError && <p className="error-panel" role="alert">Hörprofil konnte nicht geladen werden: {statsError.message}</p>}
        {stats && (
          <dl className={styles.profileMetrics}>
            <div><dt>Wiedergaben gesamt</dt><dd>{formatCount(stats.total_plays)}</dd></div>
            <div><dt>In den letzten 30 Tagen</dt><dd>{formatCount(stats.total_plays_month)}</dd></div>
            <div><dt>Meistgehörter Künstler</dt><dd>{stats.top_artists[0]?.label ?? "Noch keine Wiedergaben"}</dd></div>
          </dl>
        )}
        {signalTrack && (
          <div className={styles.currentTrack}>
            {signalTrack.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signalTrack.cover} alt="" width={36} height={36} />
            ) : <span className={styles.signalPlaceholder} aria-hidden="true"><VisualizerIcon /></span>}
            <div><span>{isPlaying && liveTrack ? "Jetzt läuft" : "Zuletzt gehört"}</span><strong>{signalTrack.title} <span>· {signalTrack.artist}</span></strong></div>
          </div>
        )}
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
              autoComplete="nickname"
              maxLength={120}
              value={form.display_name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  display_name: event.target.value,
                }))
              }
              className="field-input"
            />
          </label>
          <label className={styles.fieldLabel}>
            <span>E-Mail</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({ ...current, email: event.target.value }))
              }
              className="field-input"
            />
          </label>
          <label className={styles.fieldLabel}>
            <span>Neues Passwort</span>
            <input
              type="password"
              autoComplete="new-password"
              value={form.password}
              minLength={8}
              placeholder="Leer lassen, um beizubehalten"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              className="field-input"
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
              onClick={() => selectTab(item.key)}
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
          <p>Konto und persönliche Daten dauerhaft entfernen.</p>
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

export default function AccountPage() {
  return <Suspense fallback={<div className={styles.loadingState} role="status">Konto wird geladen…</div>}><AccountContent /></Suspense>;
}
