"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import type { SystemStatus } from "@/types";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ------------------------------------------------------------------ */
/* Section icons — thin line glyphs, accent-tinted via currentColor.    */
/* ------------------------------------------------------------------ */
type IconProps = React.SVGProps<SVGSVGElement>;
const icon = (path: React.ReactNode) =>
  function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={18}
        height={18}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
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

/** Coloured pill conveying an OK / warning / neutral status. */
function Pill({
  state,
  children,
}: {
  state: "ok" | "warn" | "neutral";
  children: React.ReactNode;
}) {
  const cls =
    state === "ok"
      ? "bg-green-500/15 text-green-400 ring-green-400/20"
      : state === "warn"
        ? "bg-red-500/15 text-red-400 ring-red-400/20"
        : "bg-white/[0.06] text-muted ring-white/10";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ${cls}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          state === "ok"
            ? "bg-green-400"
            : state === "warn"
              ? "bg-red-400"
              : "bg-muted"
        }`}
      />
      {children}
    </span>
  );
}

/** Card shell with an accent-tinted icon chip, used for every section. */
function Card({
  title,
  Icon,
  action,
  className = "",
  children,
}: {
  title: string;
  Icon: (p: IconProps) => React.ReactElement;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-white/10 bg-white/[0.025] backdrop-blur-sm p-5 sm:p-6 ${className}`}
    >
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/20">
            <Icon />
          </span>
          <h2 className="text-lg font-bold">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A label / value row inside a section. */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-white/5 last:border-0">
      <span className="text-muted text-sm">{label}</span>
      <span className="text-sm font-medium text-right">{children}</span>
    </div>
  );
}

/** A small stat tile for the content grid. */
function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/5 px-4 py-3 hover-lift">
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </div>
  );
}

/** Highlight tile for the health overview at the top. */
function Highlight({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: "ok" | "warn" | "neutral";
}) {
  const ring =
    state === "ok"
      ? "ring-green-400/25"
      : state === "warn"
        ? "ring-red-400/30"
        : "ring-white/10";
  const dot =
    state === "ok"
      ? "bg-green-400"
      : state === "warn"
        ? "bg-red-400"
        : "bg-muted";
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 ring-1 ${ring}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="mt-2 text-lg font-bold truncate">{value}</div>
    </div>
  );
}

function StatusBody({ s }: { s: SystemStatus }) {
  const diskPct =
    s.storage.disk_total > 0
      ? Math.min(100, (s.storage.disk_used / s.storage.disk_total) * 100)
      : 0;
  const diskState: "ok" | "warn" | "neutral" =
    diskPct >= 90 ? "warn" : "ok";

  return (
    <div className="flex flex-col gap-6">
      {/* Health overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Highlight
          label="Deezer"
          value={
            s.deezer.arl_ok
              ? "Angemeldet"
              : s.deezer.arl_configured
                ? "ARL ungültig"
                : "Kein ARL"
          }
          state={s.deezer.arl_ok ? "ok" : "warn"}
        />
        <Highlight
          label="Speicherauslastung"
          value={
            s.storage.disk_total > 0 ? `${Math.round(diskPct)} %` : "—"
          }
          state={s.storage.disk_total > 0 ? diskState : "neutral"}
        />
        <Highlight
          label="JWT-Secret"
          value={s.system.jwt_secure ? "Sicher" : "Standardwert"}
          state={s.system.jwt_secure ? "ok" : "warn"}
        />
        <Highlight
          label="Umgebung"
          value={s.system.app_env}
          state={
            s.system.app_env === "production" || s.system.app_env === "prod"
              ? "ok"
              : "neutral"
          }
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Deezer ARL auth */}
        <Card
          title="Deezer-Authentifizierung"
          Icon={KeyIcon}
          action={
            s.deezer.arl_ok ? (
              <Pill state="ok">Angemeldet</Pill>
            ) : s.deezer.arl_configured ? (
              <Pill state="warn">ARL ungültig / abgelaufen</Pill>
            ) : (
              <Pill state="warn">Kein ARL gesetzt</Pill>
            )
          }
        >
          <Row label="ARL-Token konfiguriert">
            {s.deezer.arl_configured ? (
              <Pill state="ok">Ja</Pill>
            ) : (
              <Pill state="warn">Nein</Pill>
            )}
          </Row>
          <Row label="Login funktioniert">
            {s.deezer.arl_ok ? (
              <Pill state="ok">Ja</Pill>
            ) : (
              <Pill state="warn">Nein</Pill>
            )}
          </Row>
          <Row label="Qualität">{s.deezer.quality}</Row>
          {!s.deezer.arl_ok && (
            <p className="text-xs text-muted mt-3 leading-relaxed">
              Setze ein gültiges <code className="text-accent-soft">DEEZER_ARL</code>{" "}
              in der API-Konfiguration und starte den Dienst neu. Ohne gültiges
              ARL ist nur die Vorschau (30 s) verfügbar.
            </p>
          )}
        </Card>

        {/* System / config */}
        <Card title="System" Icon={ServerIcon}>
          <Row label="Umgebung">
            <Pill
              state={
                s.system.app_env === "production" ||
                s.system.app_env === "prod"
                  ? "ok"
                  : "neutral"
              }
            >
              {s.system.app_env}
            </Pill>
          </Row>
          <Row label="Datenbank">{s.system.database}</Row>
          <Row label="JWT-Secret">
            {s.system.jwt_secure ? (
              <Pill state="ok">Sicher</Pill>
            ) : (
              <Pill state="warn">Standardwert!</Pill>
            )}
          </Row>
          <Row label="Secure-Cookies (HTTPS)">
            {s.system.cookie_secure ? (
              <Pill state="ok">Aktiv</Pill>
            ) : (
              <Pill state="neutral">Aus</Pill>
            )}
          </Row>
        </Card>

        {/* Storage */}
        <Card title="Speicher" Icon={DiskIcon} className="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Stat value={s.storage.track_count} label="Titel gecacht" />
            <Stat
              value={formatBytes(s.storage.total_bytes)}
              label="Belegt (Tracks)"
            />
            <Stat value={formatBytes(s.storage.disk_free)} label="Frei auf Disk" />
            <Stat value={formatBytes(s.storage.disk_total)} label="Disk gesamt" />
          </div>
          {s.storage.disk_total > 0 && (
            <div className="mb-3">
              <div className="h-2.5 rounded-full bg-black/40 overflow-hidden ring-1 ring-white/5">
                <div
                  className={`h-full rounded-full ${
                    diskState === "warn"
                      ? "bg-red-500"
                      : "gradient-violet glow-sm"
                  }`}
                  style={{ width: `${diskPct}%` }}
                />
              </div>
              <p className="text-xs text-muted mt-1.5">
                {formatBytes(s.storage.disk_used)} von{" "}
                {formatBytes(s.storage.disk_total)} belegt ·{" "}
                {Math.round(diskPct)} %
              </p>
            </div>
          )}
          <p className="text-xs text-muted">
            {s.storage.retention_days > 0
              ? `Nicht gespielt seit ${s.storage.retention_days} Tagen → automatisch gelöscht`
              : "Keine automatische Löschung"}{" "}
            ·{" "}
            <Link href="/account" className="underline hover:text-foreground">
              Speicher verwalten
            </Link>
          </p>
        </Card>

        {/* Users */}
        <Card title="Benutzer" Icon={UsersIcon}>
          <div className="grid grid-cols-2 gap-3">
            <Stat value={s.users.total} label="Gesamt" />
            <Stat value={s.users.approved} label="Freigegeben" />
            <Stat value={s.users.pending} label="Wartet auf Freigabe" />
            <Stat value={s.users.admins} label="Admins" />
          </div>
          {s.users.pending > 0 && (
            <p className="text-xs text-muted mt-3">
              <Link href="/account" className="text-accent-soft hover:underline">
                {s.users.pending} Benutzer freigeben →
              </Link>
            </p>
          )}
        </Card>

        {/* Integrations */}
        <Card title="Integrationen" Icon={PlugIcon}>
          <Row label="Spotify (Link-Import)">
            {s.integrations.spotify_configured ? (
              <Pill state="ok">Konfiguriert</Pill>
            ) : (
              <Pill state="neutral">Nicht konfiguriert</Pill>
            )}
          </Row>
          <Row label="Last.fm (Radio-Empfehlungen)">
            {s.integrations.lastfm_configured ? (
              <Pill state="ok">Konfiguriert</Pill>
            ) : (
              <Pill state="neutral">Nicht konfiguriert (Fallback aktiv)</Pill>
            )}
          </Row>
        </Card>

        {/* Content / data */}
        <Card title="Inhalte" Icon={ContentIcon} className="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Stat value={s.content.playlists} label="Playlists" />
            <Stat value={s.content.likes} label="Likes" />
            <Stat value={s.content.follows} label="Gefolgte Künstler" />
            <Stat value={s.content.plays} label="Wiedergaben" />
            <Stat value={s.content.stored_lyrics} label="Songtexte gecacht" />
            <Stat value={s.content.parties} label="Party-Sessions" />
            <Stat
              value={`${s.content.invites_used} / ${s.content.invites_total}`}
              label="Einladungen genutzt"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function StatusPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const qc = useQueryClient();

  const {
    data: status,
    isLoading,
    isFetching,
    error,
  } = useQuery<SystemStatus>({
    queryKey: ["admin-status"],
    queryFn: api.adminStatus,
    enabled: !!me?.is_admin,
  });

  if (meLoading) {
    return <p className="text-muted">Lädt…</p>;
  }

  if (!me?.is_admin) {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl font-extrabold mb-3">Systemstatus</h1>
        <p className="text-muted mb-4">
          Diese Seite ist nur für Administratoren zugänglich.
        </p>
        <Link
          href="/"
          className="inline-block px-5 py-2 rounded-full bg-accent text-white hover:bg-accent-hover"
        >
          Zur Startseite
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-in flex flex-col gap-6 w-full max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold">Systemstatus</h1>
          <p className="text-sm text-muted mt-1">
            Auth, Speicher, Benutzer &amp; Konfiguration auf einen Blick.
          </p>
        </div>
        <button
          type="button"
          onClick={() => qc.invalidateQueries({ queryKey: ["admin-status"] })}
          disabled={isFetching}
          className="press inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-white/[0.06] ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-50"
        >
          <svg
            viewBox="0 0 24 24"
            width={15}
            height={15}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={isFetching ? "animate-spin" : ""}
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
          </svg>
          {isFetching ? "Aktualisiert…" : "Aktualisieren"}
        </button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl skeleton" />
          ))}
        </div>
      )}
      {error && (
        <p className="text-red-400 text-sm">
          {error instanceof ApiError
            ? error.message
            : "Status konnte nicht geladen werden."}
        </p>
      )}

      {status && <StatusBody s={status} />}
    </div>
  );
}
