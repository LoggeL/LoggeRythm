"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import { StatusIcon, UserIcon } from "@/components/icons";
import type { AdminUser, StorageInfo, InviteInfo } from "@/types";
import { formatBytes, StatusBadge } from "./presentation";
import styles from "./account.module.css";

export function AdminUsersSection() {
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
        err instanceof Error ? err.message : "Freigabe fehlgeschlagen.",
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
        err instanceof Error ? err.message : "Entfernen fehlgeschlagen.",
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
        <p className="error-panel" role="alert">
          {error instanceof Error
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

export function AdminStorageSection() {
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
    onError: (error) => toast.error(error instanceof Error ? error.message : "Aufräumen fehlgeschlagen."),
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
            disabled={cleanup.isPending || isLoading || !!error}
            className={styles.secondarySmallButton}
          >
            {cleanup.isPending ? "Räumt auf…" : "Jetzt aufräumen"}
          </button>
        </div>
      </div>

      {isLoading && <p className={styles.stateMessage}>Lädt…</p>}
      {error && (
        <p className="error-panel" role="alert">
          {error instanceof Error
            ? error.message
            : "Speicher konnte nicht geladen werden."}
        </p>
      )}

      {data && (
        <>
          <div className={styles.storageGrid}>
            <div className={styles.storageMetric}>
              <div className={styles.storageValue}>{new Intl.NumberFormat("de-DE").format(data.track_count)}</div>
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
              <div className={styles.storageProgressTrack} role="progressbar" aria-label="Speicherauslastung" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((data.disk_used / data.disk_total) * 100)}>
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

export function AdminInvitesSection() {
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
        err instanceof Error ? err.message : "Erstellen fehlgeschlagen.",
      ),
  });

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";

  function inviteUrl(code: string) {
    return `${origin}/register?invite=${encodeURIComponent(code)}`;
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
        {create.isPending ? "Wird erstellt…" : "Einladungslink erstellen"}
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
        <p className="error-panel" role="alert">
          {error instanceof Error
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
                {new Date(inv.created_at).toLocaleDateString("de-DE")}
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
