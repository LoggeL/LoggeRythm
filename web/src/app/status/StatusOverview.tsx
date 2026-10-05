import Link from "next/link";
import type { SystemStatus } from "@/types";
import { KeyIcon, DiskIcon, UsersIcon, ContentIcon, PlugIcon, ServerIcon, ArrowIcon } from "./icons";
import type { IconProps } from "./icons";
import { formatBytes } from "./statusModel";
import styles from "./status.module.css";

type StatusTone = "ok" | "critical" | "neutral";
const numberFormatter = new Intl.NumberFormat("de-DE");

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
  kicker,
  title,
  Icon,
  action,
  open = false,
  children,
}: {
  kicker: string;
  title: string;
  Icon: (props: IconProps) => React.ReactElement;
  action?: React.ReactNode;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className={styles.panel} open={open}>
      <summary className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <span className={styles.panelIcon} aria-hidden="true">
            <Icon />
          </span>
          <div>
            <span className={styles.panelKicker}>
              {kicker}
            </span>
            <h2>{title}</h2>
          </div>
        </div>
        <div className={styles.panelSummaryActions}>{action}<span className={styles.disclosureIcon} aria-hidden="true"><ArrowIcon /></span></div>
      </summary>
      <div className={styles.panelContent}>{children}</div>
    </details>
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

export function StatusBody({ status }: { status: SystemStatus }) {
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
    <div>
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
          kicker="Zugriff"
          title="Deezer-Authentifizierung"
          Icon={KeyIcon}
          open={!status.deezer.arl_ok}
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
              API-Konfiguration und starte den Dienst neu. Deezer-Anmeldung
              fehlgeschlagen, vollständige Titel können nicht geladen werden.
            </p>
          )}
        </Panel>

        <Panel
          kicker="Kapazität"
          title="Speicher"
          Icon={DiskIcon}
          open={diskTone === "critical"}
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
            <Link href="/account?tab=admin">
              Speicher verwalten <ArrowIcon />
            </Link>
          </div>
        </Panel>

        <Panel
          kicker="Laufzeit"
          title="System"
          Icon={ServerIcon}
          open={!status.system.jwt_secure || cookiesAreCritical}
          action={<Pill tone={!status.system.jwt_secure || cookiesAreCritical ? "critical" : "ok"}>{!status.system.jwt_secure || cookiesAreCritical ? "Prüfen" : "Sicher"}</Pill>}
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
          kicker="Zugänge"
          title="Benutzer"
          Icon={UsersIcon}
          open={status.users.pending > 0}
          action={<Pill tone="neutral">{numberFormatter.format(status.users.total)} Benutzer</Pill>}
        >
          <div className={styles.metricGrid}>
            <Metric value={status.users.total} label="Gesamt" />
            <Metric value={status.users.approved} label="Freigegeben" />
            <Metric value={status.users.pending} label="Ausstehend" />
            <Metric value={status.users.admins} label="Admins" />
          </div>
          {status.users.pending > 0 && (
            <Link href="/account?tab=admin" className={styles.inlineLink}>
              {numberFormatter.format(status.users.pending)} ausstehende{" "}
              {status.users.pending === 1 ? "Freigabe" : "Freigaben"}
              <ArrowIcon />
            </Link>
          )}
        </Panel>

        <Panel
          kicker="Dienste"
          title="Integrationen"
          Icon={PlugIcon}
          action={<Pill tone="neutral">{Number(status.integrations.spotify_configured) + Number(status.integrations.lastfm_configured)} / 2 konfiguriert</Pill>}
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
          kicker="Bibliothek"
          title="Inhalte"
          Icon={ContentIcon}
          action={<Pill tone="neutral">{numberFormatter.format(status.content.playlists)} Playlists</Pill>}
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
