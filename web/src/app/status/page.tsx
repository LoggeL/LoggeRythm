"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { SystemStatus } from "@/types";
import styles from "./status.module.css";

type StatusTone = "ok" | "critical" | "neutral";
type IconProps = React.SVGProps<SVGSVGElement>;

const numberFormatter = new Intl.NumberFormat("de-DE");
const timeFormatter = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function statusContractError(field: string, expectation: string): never {
  throw new Error(
    `Ungültige Antwort von /admin/status: „${field}“ muss ${expectation} sein.`,
  );
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    statusContractError(field, "ein Objekt");
  }
  return value as Record<string, unknown>;
}

function requireBoolean(value: unknown, field: string): void {
  if (typeof value !== "boolean") statusContractError(field, "ein Wahrheitswert");
}

function requireText(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    statusContractError(field, "nicht-leerer Text");
  }
}

function requireCount(value: unknown, field: string, positive = false): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0)
  ) {
    statusContractError(
      field,
      positive
        ? "eine positive ganze Zahl"
        : "eine nicht-negative ganze Zahl",
    );
  }
}

function assertSystemStatus(value: unknown): asserts value is SystemStatus {
  const root = requireRecord(value, "Antwort");
  const deezer = requireRecord(root.deezer, "deezer");
  const storage = requireRecord(root.storage, "storage");
  const users = requireRecord(root.users, "users");
  const content = requireRecord(root.content, "content");
  const integrations = requireRecord(root.integrations, "integrations");
  const system = requireRecord(root.system, "system");

  requireBoolean(deezer.arl_configured, "deezer.arl_configured");
  requireBoolean(deezer.arl_ok, "deezer.arl_ok");
  requireText(deezer.quality, "deezer.quality");

  for (const field of [
    "track_count",
    "total_bytes",
    "disk_used",
    "disk_free",
    "retention_days",
  ] as const) {
    requireCount(storage[field], `storage.${field}`);
  }
  requireCount(storage.disk_total, "storage.disk_total", true);
  if ((storage.disk_used as number) > (storage.disk_total as number)) {
    statusContractError(
      "storage.disk_used",
      "kleiner oder gleich „storage.disk_total“",
    );
  }

  for (const field of ["total", "approved", "pending", "admins"] as const) {
    requireCount(users[field], `users.${field}`);
  }
  if ((users.approved as number) > (users.total as number)) {
    statusContractError("users.approved", "kleiner oder gleich „users.total“");
  }
  if ((users.pending as number) > (users.total as number)) {
    statusContractError("users.pending", "kleiner oder gleich „users.total“");
  }
  if ((users.admins as number) > (users.total as number)) {
    statusContractError("users.admins", "kleiner oder gleich „users.total“");
  }

  for (const field of [
    "playlists",
    "likes",
    "follows",
    "plays",
    "stored_lyrics",
    "parties",
    "invites_total",
    "invites_used",
  ] as const) {
    requireCount(content[field], `content.${field}`);
  }
  if ((content.invites_used as number) > (content.invites_total as number)) {
    statusContractError(
      "content.invites_used",
      "kleiner oder gleich „content.invites_total“",
    );
  }

  requireBoolean(
    integrations.spotify_configured,
    "integrations.spotify_configured",
  );
  requireBoolean(
    integrations.lastfm_configured,
    "integrations.lastfm_configured",
  );
  requireText(system.app_env, "system.app_env");
  requireText(system.database, "system.database");
  requireBoolean(system.jwt_secure, "system.jwt_secure");
  requireBoolean(system.cookie_secure, "system.cookie_secure");
}

async function fetchSystemStatus(): Promise<SystemStatus> {
  const value: unknown = await api.adminStatus();
  assertSystemStatus(value);
  return value;
}

function formatBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    statusContractError("Speicherwert", "eine nicht-negative ganze Zahl");
  }
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  if (index >= units.length) {
    statusContractError("Speicherwert", "kleiner als 1 PB");
  }
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

const icon = (path: React.ReactNode) =>
  function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={19}
        height={19}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden="true"
        {...props}
      >
        {path}
      </svg>
    );
  };

const KeyIcon = icon(
  <>
    <circle cx="8" cy="8" r="3.5" />
    <path d="M10.5 10.5 19 19m-3-3 2-2m-4 0 2-2" />
  </>,
);
const DiskIcon = icon(
  <>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </>,
);
const UsersIcon = icon(
  <>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3.2 3.2 0 0 1 0 6.2M16.5 19a5.5 5.5 0 0 0-2.2-4.4" />
  </>,
);
const ContentIcon = icon(
  <>
    <path d="M9 18V6l11-2v12" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </>,
);
const PlugIcon = icon(
  <>
    <path d="M9 2v6m6-6v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5" />
  </>,
);
const ServerIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </>,
);
const RefreshIcon = icon(
  <>
    <path d="M20 11a8 8 0 1 0-2.35 5.65" />
    <path d="M20 5v6h-6" />
  </>,
);
const ArrowIcon = icon(<path d="m9 18 6-6-6-6" />);
const BackIcon = icon(<path d="m15 18-6-6 6-6" />);

function toneClass(tone: StatusTone): string {
  if (tone === "ok") return styles.toneOk;
  if (tone === "critical") return styles.toneCritical;
  return styles.toneNeutral;
}

function Pill({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  return (
    <span className={`${styles.pill} ${toneClass(tone)}`}>
      <span className={styles.statusDot} aria-hidden="true" />
      {children}
    </span>
  );
}

function Panel({
  number,
  kicker,
  title,
  Icon,
  action,
  className = "",
  children,
}: {
  number: string;
  kicker: string;
  title: string;
  Icon: (props: IconProps) => React.ReactElement;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${styles.panel} ${className}`}>
      <header className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <span className={styles.panelIcon} aria-hidden="true">
            <Icon />
          </span>
          <div>
            <span className={styles.panelKicker}>
              {number} · {kicker}
            </span>
            <h2>{title}</h2>
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div className={styles.metric}>
      <strong>{typeof value === "number" ? numberFormatter.format(value) : value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Signal({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: StatusTone;
}) {
  return (
    <div className={styles.signal}>
      <span className={`${styles.signalMarker} ${toneClass(tone)}`} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function StatusBody({ status }: { status: SystemStatus }) {
  const diskPct = (status.storage.disk_used / status.storage.disk_total) * 100;
  const diskTone: StatusTone = diskPct >= 90 ? "critical" : "ok";
  const environmentIsProduction =
    status.system.app_env === "production" || status.system.app_env === "prod";
  const cookiesAreCritical =
    environmentIsProduction && !status.system.cookie_secure;
  const warningCount =
    Number(!status.deezer.arl_ok) +
    Number(!status.system.jwt_secure) +
    Number(diskTone === "critical") +
    Number(cookiesAreCritical);

  return (
    <div className={styles.statusBody}>
      <section className={styles.overview} aria-labelledby="system-overview-title">
        <div className={styles.overviewLead}>
          <span className={styles.eyebrow}>Momentaufnahme</span>
          <div className={styles.overviewTitleLine}>
            <span
              className={`${styles.overallIndicator} ${
                warningCount === 0 ? styles.toneOk : styles.toneCritical
              }`}
              aria-hidden="true"
            />
            <h2 id="system-overview-title">
              {warningCount === 0
                ? "Kernsysteme stabil"
                : warningCount === 1
                  ? "Ein Hinweis benötigt Aufmerksamkeit"
                  : `${warningCount} Hinweise benötigen Aufmerksamkeit`}
            </h2>
          </div>
          <p>
            Live-Prüfung von Zugriff, Kapazität und sicherheitsrelevanter
            Konfiguration.
          </p>
        </div>

        <div className={styles.telemetry} aria-hidden="true">
          <span className={status.deezer.arl_ok ? styles.toneOk : styles.toneCritical} />
          <span className={toneClass(diskTone)} />
          <span className={status.system.jwt_secure ? styles.toneOk : styles.toneCritical} />
          <span className={environmentIsProduction ? styles.toneOk : styles.toneNeutral} />
        </div>

        <div className={styles.signalGrid}>
          <Signal
            label="Deezer"
            value={
              status.deezer.arl_ok
                ? "Angemeldet"
                : status.deezer.arl_configured
                  ? "ARL ungültig"
                  : "Kein ARL"
            }
            tone={status.deezer.arl_ok ? "ok" : "critical"}
          />
          <Signal
            label="Speicher"
            value={`${Math.round(diskPct)} % belegt`}
            tone={diskTone}
          />
          <Signal
            label="JWT-Secret"
            value={status.system.jwt_secure ? "Sicher" : "Standardwert"}
            tone={status.system.jwt_secure ? "ok" : "critical"}
          />
          <Signal
            label="Umgebung"
            value={status.system.app_env}
            tone={environmentIsProduction ? "ok" : "neutral"}
          />
        </div>
      </section>

      <div className={styles.panelGrid}>
        <Panel
          number="01"
          kicker="Zugriff"
          title="Deezer-Authentifizierung"
          Icon={KeyIcon}
          className={styles.authPanel}
          action={
            status.deezer.arl_ok ? (
              <Pill tone="ok">Angemeldet</Pill>
            ) : status.deezer.arl_configured ? (
              <Pill tone="critical">ARL ungültig oder abgelaufen</Pill>
            ) : (
              <Pill tone="critical">Kein ARL gesetzt</Pill>
            )
          }
        >
          <Row label="ARL-Token konfiguriert">
            <Pill tone={status.deezer.arl_configured ? "ok" : "critical"}>
              {status.deezer.arl_configured ? "Ja" : "Nein"}
            </Pill>
          </Row>
          <Row label="Login funktioniert">
            <Pill tone={status.deezer.arl_ok ? "ok" : "critical"}>
              {status.deezer.arl_ok ? "Ja" : "Nein"}
            </Pill>
          </Row>
          <Row label="Audioqualität">{status.deezer.quality}</Row>
          {!status.deezer.arl_ok && (
            <p className={styles.guidance}>
              Setze ein gültiges <code>DEEZER_ARL</code> in der
              API-Konfiguration und starte den Dienst neu. Ohne gültiges ARL ist
              nur die 30-Sekunden-Vorschau verfügbar.
            </p>
          )}
        </Panel>

        <Panel
          number="02"
          kicker="Kapazität"
          title="Speicher"
          Icon={DiskIcon}
          className={styles.storagePanel}
          action={<Pill tone={diskTone}>{Math.round(diskPct)} % belegt</Pill>}
        >
          <div className={styles.storageMetrics}>
            <Metric value={status.storage.track_count} label="Titel gecacht" />
            <Metric value={formatBytes(status.storage.total_bytes)} label="Tracks" />
            <Metric value={formatBytes(status.storage.disk_free)} label="Frei" />
            <Metric value={formatBytes(status.storage.disk_total)} label="Gesamt" />
          </div>
          <div className={styles.capacityBlock}>
            <div
              className={styles.capacityTrack}
              role="progressbar"
              aria-label="Speicherauslastung"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(diskPct)}
              aria-valuetext={`${formatBytes(status.storage.disk_used)} von ${formatBytes(status.storage.disk_total)} belegt`}
            >
              <span
                className={`${styles.capacityFill} ${toneClass(diskTone)}`}
                style={{ "--capacity": `${diskPct}%` } as React.CSSProperties}
              />
            </div>
            <div className={styles.capacityMeta}>
              <span>
                {formatBytes(status.storage.disk_used)} von{" "}
                {formatBytes(status.storage.disk_total)} belegt
              </span>
              <span>{Math.round(diskPct)} %</span>
            </div>
          </div>
          <div className={styles.panelFooter}>
            <span>
              {status.storage.retention_days > 0
                ? `Automatische Löschung nach ${status.storage.retention_days} inaktiven Tagen`
                : "Keine automatische Löschung"}
            </span>
            <Link href="/account">
              Speicher verwalten <ArrowIcon />
            </Link>
          </div>
        </Panel>

        <Panel
          number="03"
          kicker="Laufzeit"
          title="System"
          Icon={ServerIcon}
          className={styles.systemPanel}
        >
          <Row label="Umgebung">
            <Pill tone={environmentIsProduction ? "ok" : "neutral"}>
              {status.system.app_env}
            </Pill>
          </Row>
          <Row label="Datenbank">{status.system.database}</Row>
          <Row label="JWT-Secret">
            <Pill tone={status.system.jwt_secure ? "ok" : "critical"}>
              {status.system.jwt_secure ? "Sicher" : "Standardwert"}
            </Pill>
          </Row>
          <Row label="Secure-Cookies">
            <Pill
              tone={
                status.system.cookie_secure
                  ? "ok"
                  : cookiesAreCritical
                    ? "critical"
                    : "neutral"
              }
            >
              {status.system.cookie_secure ? "Aktiv" : "Aus"}
            </Pill>
          </Row>
        </Panel>

        <Panel
          number="04"
          kicker="Zugänge"
          title="Benutzer"
          Icon={UsersIcon}
          className={styles.usersPanel}
        >
          <div className={styles.metricGrid}>
            <Metric value={status.users.total} label="Gesamt" />
            <Metric value={status.users.approved} label="Freigegeben" />
            <Metric value={status.users.pending} label="Ausstehend" />
            <Metric value={status.users.admins} label="Admins" />
          </div>
          {status.users.pending > 0 && (
            <Link href="/account" className={styles.inlineLink}>
              {numberFormatter.format(status.users.pending)} ausstehende{" "}
              {status.users.pending === 1 ? "Freigabe" : "Freigaben"}
              <ArrowIcon />
            </Link>
          )}
        </Panel>

        <Panel
          number="05"
          kicker="Dienste"
          title="Integrationen"
          Icon={PlugIcon}
          className={styles.integrationsPanel}
        >
          <Row label="Spotify · Link-Import">
            <Pill
              tone={
                status.integrations.spotify_configured ? "ok" : "neutral"
              }
            >
              {status.integrations.spotify_configured
                ? "Konfiguriert"
                : "Nicht konfiguriert"}
            </Pill>
          </Row>
          <Row label="Last.fm · Empfehlungen">
            <Pill
              tone={status.integrations.lastfm_configured ? "ok" : "neutral"}
            >
              {status.integrations.lastfm_configured
                ? "Konfiguriert"
                : "Nicht konfiguriert"}
            </Pill>
          </Row>
        </Panel>

        <Panel
          number="06"
          kicker="Bibliothek"
          title="Inhalte"
          Icon={ContentIcon}
          className={styles.contentPanel}
        >
          <div className={styles.contentMetrics}>
            <Metric value={status.content.playlists} label="Playlists" />
            <Metric value={status.content.likes} label="Likes" />
            <Metric value={status.content.follows} label="Gefolgte Künstler" />
            <Metric value={status.content.plays} label="Wiedergaben" />
            <Metric value={status.content.stored_lyrics} label="Songtexte" />
            <Metric value={status.content.parties} label="Party-Sessions" />
            <Metric
              value={`${numberFormatter.format(status.content.invites_used)} / ${numberFormatter.format(status.content.invites_total)}`}
              label="Einladungen genutzt"
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

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
      <header className={styles.pageHeader}>
        <div>
          <Link href="/account" className={styles.backLink}>
            <BackIcon /> Konto
          </Link>
          <span className={styles.eyebrow}>Admin-Konsole · Live-Diagnose</span>
          <h1>Systemstatus</h1>
          <p>Auth, Speicher, Benutzer und Konfiguration auf einen Blick.</p>
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
            className={styles.refreshButton}
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
