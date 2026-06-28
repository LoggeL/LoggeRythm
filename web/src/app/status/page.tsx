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
      ? "bg-green-500/15 text-green-400"
      : state === "warn"
        ? "bg-red-500/15 text-red-400"
        : "bg-panel-hover text-muted";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}
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

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-panel rounded-lg p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-xl font-bold">{title}</h2>
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
    <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0">
      <span className="text-muted text-sm">{label}</span>
      <span className="text-sm font-medium text-right">{children}</span>
    </div>
  );
}

/** A small stat tile for the content grid. */
function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="bg-background rounded-md px-4 py-3">
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </div>
  );
}

function StatusBody({ s }: { s: SystemStatus }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Deezer ARL auth */}
      <Section
        title="Deezer-Authentifizierung"
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
          <p className="text-xs text-muted mt-3">
            Setze ein gültiges <code>DEEZER_ARL</code> in der API-Konfiguration
            und starte den Dienst neu. Ohne gültiges ARL ist nur die Vorschau
            (30 s) verfügbar.
          </p>
        )}
      </Section>

      {/* Storage */}
      <Section title="Speicher">
        <div className="flex flex-wrap gap-3 mb-4">
          <Stat value={s.storage.track_count} label="Titel gecacht" />
          <Stat value={formatBytes(s.storage.total_bytes)} label="Belegt (Tracks)" />
          <Stat value={formatBytes(s.storage.disk_free)} label="Frei auf Disk" />
          <Stat value={formatBytes(s.storage.disk_total)} label="Disk gesamt" />
        </div>
        {s.storage.disk_total > 0 && (
          <div className="mb-2">
            <div className="h-2 rounded-full bg-background overflow-hidden">
              <div
                className="h-full bg-accent"
                style={{
                  width: `${Math.min(
                    100,
                    (s.storage.disk_used / s.storage.disk_total) * 100,
                  )}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted mt-1">
              {formatBytes(s.storage.disk_used)} von{" "}
              {formatBytes(s.storage.disk_total)} belegt
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
      </Section>

      {/* Users */}
      <Section title="Benutzer">
        <div className="flex flex-wrap gap-3">
          <Stat value={s.users.total} label="Gesamt" />
          <Stat value={s.users.approved} label="Freigegeben" />
          <Stat value={s.users.pending} label="Wartet auf Freigabe" />
          <Stat value={s.users.admins} label="Admins" />
        </div>
        {s.users.pending > 0 && (
          <p className="text-xs text-muted mt-3">
            <Link href="/account" className="underline hover:text-foreground">
              {s.users.pending} Benutzer freigeben →
            </Link>
          </p>
        )}
      </Section>

      {/* Content / data */}
      <Section title="Inhalte">
        <div className="flex flex-wrap gap-3">
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
      </Section>

      {/* Integrations */}
      <Section title="Integrationen">
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
      </Section>

      {/* System / config */}
      <Section title="System">
        <Row label="Umgebung">
          <Pill
            state={
              s.system.app_env === "production" || s.system.app_env === "prod"
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
      </Section>
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
    <div className="animate-in flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-3xl font-extrabold">Systemstatus</h1>
        <button
          type="button"
          onClick={() => qc.invalidateQueries({ queryKey: ["admin-status"] })}
          disabled={isFetching}
          className="press px-4 py-2 rounded-full text-sm font-medium bg-panel-hover hover:bg-white/10 disabled:opacity-50"
        >
          {isFetching ? "Aktualisiert…" : "Aktualisieren"}
        </button>
      </div>

      {isLoading && <p className="text-muted">Lädt…</p>}
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
