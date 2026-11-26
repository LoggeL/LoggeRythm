import Link from "next/link";
import type { SystemStatus } from "@/types";
import { ContentIcon, DiskIcon, KeyIcon, PlugIcon, ServerIcon, UsersIcon } from "./statusIcons";
import { buildAdminSectionHref } from "./sections";
import { formatBytes } from "./statusModel";
import { formatNumber, Metric, MetricGrid, Panel, Pill, Row, Signal, TONE_FILL, ToneGlyph, type StatusTone } from "./statusParts";

const DISK_CRITICAL_PCT = 90;
const linkClass = "section-link inline-flex min-h-11 items-center";

type Fault = { target: string; area: string; message: string };

export function StatusBody({ status }: { status: SystemStatus }) {
  const diskPct = (status.storage.disk_used / status.storage.disk_total) * 100;
  const diskShown = Math.floor(diskPct);
  const diskTone: StatusTone = diskPct >= DISK_CRITICAL_PCT ? "critical" : "ok";
  const cleanupStopped =
    status.storage.cleanup_stopped_at !== null && status.storage.cleanup_error !== null
      ? {
          at: new Date(status.storage.cleanup_stopped_at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }),
          error: status.storage.cleanup_error,
        }
      : null;
  const environmentIsProduction = status.system.app_env === "production" || status.system.app_env === "prod";
  const cookiesAreCritical = environmentIsProduction && !status.system.cookie_secure;
  const systemNeedsCheck = !status.system.jwt_secure || cookiesAreCritical;
  const deezerLabel = status.deezer.arl_ok ? "Angemeldet" : status.deezer.arl_configured ? "ARL ungültig" : "Kein ARL";
  const diskUsage = `${formatBytes(status.storage.disk_used)} von ${formatBytes(status.storage.disk_total)} belegt`;
  const integrationsConfigured =
    Number(status.integrations.spotify_configured) + Number(status.integrations.lastfm_configured) + Number(status.integrations.mail_configured);

  const faults: Fault[] = [];
  if (!status.deezer.arl_ok) {
    faults.push({
      target: "status-deezer",
      area: "Deezer",
      message: status.deezer.arl_configured ? "Das ARL-Token ist ungültig oder abgelaufen." : "Es ist kein ARL-Token gesetzt.",
    });
  }
  if (diskTone === "critical") {
    faults.push({ target: "status-storage", area: "Speicher", message: `Der Datenträger ist zu ${diskShown} % belegt.` });
  }
  if (cleanupStopped) {
    faults.push({
      target: "status-storage",
      area: "Speicher",
      message: `Die automatische Löschung ist seit ${cleanupStopped.at} gestoppt und läuft erst nach einem Neustart der API wieder.`,
    });
  }
  if (!status.system.jwt_secure) {
    faults.push({ target: "status-system", area: "System", message: "Das JWT-Secret steht noch auf dem Standardwert." });
  }
  if (cookiesAreCritical) {
    faults.push({ target: "status-system", area: "System", message: "Secure-Cookies sind in der Produktionsumgebung ausgeschaltet." });
  }
  const healthy = faults.length === 0;

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <section aria-labelledby="system-overview-title">
        <p className={`flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] ${healthy ? "text-success" : "text-danger"}`}>
          <ToneGlyph tone={healthy ? "ok" : "critical"} />
          <span className="text-muted">Gesamtzustand</span>
          <span aria-hidden="true" className="text-subtle">
            /
          </span>
          <span>{healthy ? "OK" : "Gestört"}</span>
        </p>
        <h2
          id="system-overview-title"
          className={`mt-3 text-[clamp(2rem,5.4vw,3.75rem)] font-extrabold leading-[0.98] tracking-[-0.045em] [overflow-wrap:anywhere] [text-wrap:balance] ${healthy ? "" : "text-danger"}`}
        >
          {healthy ? "Alle Kernsysteme laufen" : faults.length === 1 ? "1 Störung braucht deine Aufmerksamkeit" : `${faults.length} Störungen brauchen deine Aufmerksamkeit`}
        </h2>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted">Live-Prüfung von Zugriff, Kapazität und sicherheitsrelevanter Konfiguration.</p>

        {!healthy && (
          <ul aria-label="Störungen" className="mt-6 border-t border-danger/40">
            {faults.map((fault) => (
              <li key={fault.message} className="border-b border-hairline">
                <a
                  href={`#${fault.target}`}
                  className="group flex min-h-11 flex-wrap items-baseline gap-x-4 gap-y-0.5 py-3 text-sm transition-colors hover:bg-white/[0.03] motion-reduce:transition-none"
                >
                  <span className="label-mono w-20 shrink-0 text-danger">{fault.area}</span>
                  <span className="min-w-0 flex-1 basis-48 font-medium [overflow-wrap:anywhere]">{fault.message}</span>
                  <span aria-hidden="true" className="label-mono group-hover:text-foreground">
                    Details ↓
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}

        <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Signal label="Deezer" value={deezerLabel} tone={status.deezer.arl_ok ? "ok" : "critical"} />
          <Signal label="Speicher" value={`${diskShown} % belegt`} tone={diskTone} />
          <Signal label="JWT-Secret" value={status.system.jwt_secure ? "Sicher" : "Standardwert"} tone={status.system.jwt_secure ? "ok" : "critical"} />
          <Signal label="Umgebung" value={status.system.app_env} tone={environmentIsProduction ? "ok" : "neutral"} />
        </dl>
      </section>

      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
        <Panel
          id="status-deezer"
          index="01"
          title="Deezer-Authentifizierung"
          Icon={KeyIcon}
          summary={<Pill tone={status.deezer.arl_ok ? "ok" : "critical"}>{status.deezer.arl_ok ? "Angemeldet" : status.deezer.arl_configured ? "ARL ungültig oder abgelaufen" : "Kein ARL gesetzt"}</Pill>}
        >
          <Row label="ARL-Token konfiguriert">
            <Pill tone={status.deezer.arl_configured ? "ok" : "critical"}>{status.deezer.arl_configured ? "Ja" : "Nein"}</Pill>
          </Row>
          <Row label="Login funktioniert">
            <Pill tone={status.deezer.arl_ok ? "ok" : "critical"}>{status.deezer.arl_ok ? "Ja" : "Nein"}</Pill>
          </Row>
          <Row label="Audioqualität">{status.deezer.quality}</Row>
          {!status.deezer.arl_ok && (
            <p className="error-panel mt-2">
              Die Deezer-Anmeldung ist fehlgeschlagen, vollständige Titel können nicht geladen werden. Setze ein gültiges <code className="font-mono text-xs">DEEZER_ARL</code> in der
              API-Konfiguration und starte den Dienst neu.
            </p>
          )}
        </Panel>

        <Panel id="status-system" index="02" title="System" Icon={ServerIcon} summary={<Pill tone={systemNeedsCheck ? "critical" : "ok"}>{systemNeedsCheck ? "Prüfen" : "Sicher"}</Pill>}>
          <Row label="Umgebung">
            <Pill tone={environmentIsProduction ? "ok" : "neutral"}>{status.system.app_env}</Pill>
          </Row>
          <Row label="Datenbank">{status.system.database}</Row>
          <Row label="JWT-Secret">
            <Pill tone={status.system.jwt_secure ? "ok" : "critical"}>{status.system.jwt_secure ? "Sicher" : "Standardwert"}</Pill>
          </Row>
          <Row label="Secure-Cookies">
            <Pill tone={status.system.cookie_secure ? "ok" : cookiesAreCritical ? "critical" : "neutral"}>{status.system.cookie_secure ? "Aktiv" : "Aus"}</Pill>
          </Row>
        </Panel>

        <Panel id="status-storage" index="03" title="Speicher" Icon={DiskIcon} wide summary={cleanupStopped ? <Pill tone="critical">Löschung gestoppt</Pill> : <Pill tone={diskTone}>{diskShown} % belegt</Pill>}>
          <div className="grid gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-end">
            <div className="min-w-0">
              <p className="flex items-baseline gap-3">
                <span className={`font-display text-[clamp(3rem,9vw,4.5rem)] font-extrabold leading-none tracking-[-0.05em] tabular-nums ${diskTone === "critical" ? "text-danger" : ""}`}>
                  {diskShown}
                  <span className="ml-1 text-[0.45em] tracking-normal">%</span>
                </span>
                <span className="label-mono">belegt</span>
              </p>
              <div className="relative mt-4 pb-5">
                <div
                  role="progressbar"
                  aria-label="Speicherauslastung"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={diskShown}
                  aria-valuetext={diskUsage}
                  className="h-2 overflow-hidden rounded-[2px] bg-white/10"
                >
                  <span className={`block h-full ${TONE_FILL[diskTone]}`} style={{ width: `${Math.min(100, diskPct)}%` }} />
                </div>
                <span aria-hidden="true" className="absolute top-0 h-3.5 w-px bg-danger" style={{ left: `${DISK_CRITICAL_PCT}%` }} />
                <span aria-hidden="true" className="label-mono absolute right-0 bottom-0 text-[10px]">
                  Warnschwelle {DISK_CRITICAL_PCT} %
                </span>
              </div>
              <p className="text-sm tabular-nums text-muted">{diskUsage}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              <Metric value={status.storage.track_count} label="Titel im Cache" />
              <Metric value={formatBytes(status.storage.total_bytes)} label="Belegt durch Titel" />
              <Metric value={formatBytes(status.storage.disk_free)} label="Frei" />
              <Metric value={formatBytes(status.storage.disk_total)} label="Gesamt" />
            </dl>
          </div>
          {cleanupStopped ? (
            <p role="alert" className="mt-4 border-t border-hairline pt-2 text-sm text-danger [overflow-wrap:anywhere]">
              Automatische Löschung seit {cleanupStopped.at} gestoppt (bis zum Neustart der API): {cleanupStopped.error}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-hairline pt-2">
            <span className="text-sm text-muted">
              {status.storage.retention_days > 0
                ? `Automatische Löschung nach ${status.storage.retention_days} inaktiven Tagen, außer gelikten Titeln und Titeln in Playlists`
                : "Keine automatische Löschung"}
            </span>
            <Link href={buildAdminSectionHref("storage")} className={linkClass}>
              Speicher verwalten
            </Link>
          </div>
        </Panel>

        <Panel id="status-users" index="04" title="Benutzer" Icon={UsersIcon} summary={<Pill tone="neutral">{formatNumber(status.users.total)} Benutzer</Pill>}>
          <dl className="grid grid-cols-2 gap-x-6">
            <Metric value={status.users.total} label="Gesamt" />
            <Metric value={status.users.approved} label="Freigegeben" />
            <Metric value={status.users.pending} label="Ausstehend" />
            <Metric value={status.users.admins} label="Admins" />
          </dl>
          {status.users.pending > 0 && (
            <div className="border-t border-hairline pt-1">
              <Link href={buildAdminSectionHref("users")} className={`${linkClass} whitespace-normal`}>
                {formatNumber(status.users.pending)} ausstehende {status.users.pending === 1 ? "Freigabe" : "Freigaben"} bearbeiten
              </Link>
            </div>
          )}
        </Panel>

        <Panel id="status-integrations" index="05" title="Integrationen" Icon={PlugIcon} summary={<Pill tone="neutral">{integrationsConfigured} / 3 konfiguriert</Pill>}>
          <Row label="Spotify · Link-Import">
            <Pill tone={status.integrations.spotify_configured ? "ok" : "neutral"}>{status.integrations.spotify_configured ? "Konfiguriert" : "Nicht konfiguriert"}</Pill>
          </Row>
          <Row label="Last.fm · Empfehlungen">
            <Pill tone={status.integrations.lastfm_configured ? "ok" : "neutral"}>{status.integrations.lastfm_configured ? "Konfiguriert" : "Nicht konfiguriert"}</Pill>
          </Row>
          <Row label="Resend · Mail">
            <Pill tone={status.integrations.mail_configured ? "ok" : "neutral"}>{status.integrations.mail_configured ? "Konfiguriert" : "Nicht konfiguriert"}</Pill>
          </Row>
        </Panel>

        <Panel id="status-content" index="06" title="Inhalte" Icon={ContentIcon} wide summary={<Pill tone="neutral">{formatNumber(status.content.playlists)} Playlists</Pill>}>
          <MetricGrid>
            <Metric value={status.content.playlists} label="Playlists" />
            <Metric value={status.content.likes} label="Likes" />
            <Metric value={status.content.follows} label="Gefolgte Künstler" />
            <Metric value={status.content.plays} label="Wiedergaben" />
            <Metric value={status.content.stored_lyrics} label="Songtexte" />
            <Metric value={status.content.parties} label="Party-Sessions" />
            <Metric value={`${formatNumber(status.content.invites_used)} / ${formatNumber(status.content.invites_total)}`} label="Einladungen genutzt" />
          </MetricGrid>
        </Panel>
      </div>
    </div>
  );
}
