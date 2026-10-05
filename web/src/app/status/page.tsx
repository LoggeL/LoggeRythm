"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { SystemStatus } from "@/types";
import { KeyIcon, ServerIcon, RefreshIcon, ArrowIcon, BackIcon } from "./icons";
import { fetchSystemStatus } from "./statusModel";
import { StatusBody } from "./StatusOverview";
import styles from "./status.module.css";

const timeFormatter = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export default function StatusPage() {
  const queryClient = useQueryClient();
  const {
    data: me,
    isLoading: meLoading,
    error: meError,
    isFetching: meFetching,
  } = useQuery({
    queryKey: ["status-auth"],
    queryFn: api.me,
    retry: false,
    staleTime: 60_000,
  });
  const {
    data: status,
    dataUpdatedAt,
    isLoading,
    isFetching,
    error,
  } = useQuery<SystemStatus>({
    queryKey: ["admin-status"],
    queryFn: fetchSystemStatus,
    enabled: !!me?.is_admin,
  });

  if (meLoading) {
    return (
      <div className={styles.gate} role="status">
        <span className={styles.gateIcon} aria-hidden="true">
          <ServerIcon />
        </span>
        <span className={styles.eyebrow}>Admin-Konsole</span>
        <p>Berechtigung wird geprüft…</p>
      </div>
    );
  }

  if (meError) {
    return (
      <section className={styles.gate} role="alert">
        <span className={styles.gateIcon} aria-hidden="true">
          <KeyIcon />
        </span>
        <span className={styles.eyebrow}>Berechtigungsprüfung fehlgeschlagen</span>
        <h1>Systemstatus</h1>
        <p>
          {meError instanceof ApiError
            ? meError.message
            : meError instanceof Error
              ? meError.message
              : "Die Administratorrechte konnten nicht geprüft werden."}
        </p>
        <button
          type="button"
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["status-auth"] })
          }
          disabled={meFetching}
          className={styles.errorRetry}
        >
          {meFetching ? "Wird erneut geprüft…" : "Erneut prüfen"}
        </button>
      </section>
    );
  }

  if (!me?.is_admin) {
    return (
      <section className={styles.gate}>
        <span className={styles.gateIcon} aria-hidden="true">
          <KeyIcon />
        </span>
        <span className={styles.eyebrow}>Geschützter Bereich</span>
        <h1>Systemstatus</h1>
        <p>Diese Seite ist ausschließlich für Administratoren zugänglich.</p>
        <Link href="/" className={styles.primaryLink}>
          Zur Startseite <ArrowIcon />
        </Link>
      </section>
    );
  }

  const updatedAt =
    status && dataUpdatedAt > 0
      ? timeFormatter.format(new Date(dataUpdatedAt))
      : null;

  return (
    <div className={styles.page} aria-busy={isFetching}>
      <header className={`${styles.pageHeader} page-header`}>
        <div>
          <Link href="/account" className={styles.backLink}>
            <BackIcon /> Konto
          </Link>
          <span className="page-eyebrow">Verwaltung</span>
          <h1 className="page-title">Systemstatus</h1>
          <p className="page-description">Betriebszustand und Hinweise. Öffne einen Bereich für Details.</p>
        </div>

        <div className={styles.headerActions}>
          <div className={styles.refreshStamp} aria-live="polite">
            <span>{isFetching ? "Status" : "Zuletzt geprüft"}</span>
            <strong>
              {isFetching
                ? "Wird aktualisiert…"
                : updatedAt ?? "Noch keine Messung"}
            </strong>
          </div>
          <button
            type="button"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["admin-status"] })
            }
            disabled={isFetching}
            className="action-secondary"
          >
            <RefreshIcon className={isFetching ? styles.refreshing : ""} />
            {isFetching ? "Wird aktualisiert…" : "Neu prüfen"}
          </button>
        </div>
      </header>

      {isLoading && (
        <div className={styles.loadingRegion} role="status">
          <span className={styles.srOnly}>Systemstatus wird geladen.</span>
          <div className={styles.loadingSignals} aria-hidden="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <span key={index} />
            ))}
          </div>
          <div className={styles.loadingPanels} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}

      {error && (
        <div className={styles.errorPanel} role="alert">
          <div>
            <span className={styles.eyebrow}>Diagnose fehlgeschlagen</span>
            <strong>Status konnte nicht vollständig aktualisiert werden.</strong>
            <p>
              {error instanceof ApiError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : "Status konnte nicht geladen werden."}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["admin-status"] })
            }
            disabled={isFetching}
            className={styles.errorRetry}
          >
            Erneut prüfen
          </button>
        </div>
      )}

      {status && <StatusBody status={status} />}
    </div>
  );
}
