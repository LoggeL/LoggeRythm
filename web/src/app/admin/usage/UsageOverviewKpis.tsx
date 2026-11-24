import {
  computeStorageShares,
  formatBytes,
  formatDuration,
  formatFullDateTime,
  USAGE_RANGE_LABELS,
} from "@/lib/adminUsage";
import type { AdminUsageOverview, AdminUsageRange } from "@/types";

const countFormatter = new Intl.NumberFormat("de-DE");
const formatCount = (value: number) => countFormatter.format(value);

function KpiCard({
  label,
  value,
  detail,
  accentDot,
}: {
  label: string;
  value: string;
  detail: string;
  accentDot?: "live" | "idle";
}) {
  return (
    <div className="surface-card flex min-w-0 flex-col justify-between gap-2.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <dt className="label-mono truncate">{label}</dt>
        {accentDot && (
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${
              accentDot === "live"
                ? "bg-success shadow-[0_0_8px_var(--success)]"
                : "border border-subtle"
            }`}
          />
        )}
      </div>
      <dd className="min-w-0">
        <p className="font-display text-[clamp(1.65rem,3vw,2.25rem)] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-foreground [overflow-wrap:anywhere]">
          {value}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
          {detail}
        </p>
      </dd>
    </div>
  );
}

export default function UsageOverviewKpis({
  overview,
  range,
  requestTrackingSince,
}: {
  overview: AdminUsageOverview;
  range: AdminUsageRange;
  requestTrackingSince: string | null;
}) {
  const { storage } = overview;
  const shares = computeStorageShares(storage);
  const diskPctShown = Math.round(shares.diskUsedPct);
  const diskCritical = shares.diskUsedPct >= 90;
  const trackingDate = formatFullDateTime(requestTrackingSince);
  const rangeLabel = USAGE_RANGE_LABELS[range];

  const userDetailParts = [`${formatCount(overview.approved_users)} freigegeben`];
  if (overview.pending_users > 0) {
    userDetailParts.push(`${formatCount(overview.pending_users)} wartend`);
  }

  const connectDetailParts = [
    overview.online_connect_users === 1
      ? "1 Nutzer online"
      : `${formatCount(overview.online_connect_users)} Nutzer online`,
  ];
  if (overview.active_parties > 0) {
    connectDetailParts.push(
      overview.active_parties === 1
        ? "1 aktive Jam"
        : `${formatCount(overview.active_parties)} aktive Jams`,
    );
  }

  return (
    <section aria-label="Systemübersicht" className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label={`Aktive Nutzer (${rangeLabel})`}
          value={`${formatCount(overview.active_users)} / ${formatCount(overview.total_users)}`}
          detail={userDetailParts.join(" · ")}
        />
        <KpiCard
          label={`Wiedergaben (${rangeLabel})`}
          value={formatCount(overview.total_plays)}
          detail={`${formatDuration(overview.total_listening_sec)} · ${formatCount(overview.unique_tracks_played)} Titel`}
        />
        <KpiCard
          label={`Angefordert (${rangeLabel})`}
          value={formatCount(overview.tracks_requested)}
          detail={`${formatCount(overview.tracks_materialized)} neu geladen (${formatBytes(overview.materialized_bytes)})`}
        />
        <KpiCard
          label="Audio-Cache"
          value={formatBytes(storage.total_audio_bytes)}
          detail={`${formatCount(storage.cached_tracks)} Titel · ${formatBytes(storage.exclusive_audio_bytes)} exklusiv`}
        />
        <KpiCard
          label="Connect Live"
          value={formatCount(overview.online_connect_devices)}
          detail={connectDetailParts.join(" · ")}
          accentDot={overview.online_connect_devices > 0 ? "live" : "idle"}
        />
      </dl>

      <section
        aria-labelledby="usage-storage-distribution-title"
        className="surface-card p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h2
              id="usage-storage-distribution-title"
              className="font-display text-lg font-bold tracking-[-0.02em]"
            >
              Speicherverteilung im Audio-Cache
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {storage.retention_days > 0
                ? `Automatische Bereinigung nach ${storage.retention_days} inaktiven Tagen (Likes & Playlists geschützt).`
                : "Keine automatische Cache-Bereinigung aktiv."}
            </p>
          </div>
          <p className="font-mono text-xs tabular-nums text-muted">
            <span className={diskCritical ? "font-semibold text-danger" : "font-semibold text-foreground"}>
              {diskPctShown} %
            </span>{" "}
            Datenträger belegt ({formatBytes(storage.disk_used)} / {formatBytes(storage.disk_total)} ·{" "}
            {formatBytes(storage.disk_free)} frei)
          </p>
        </div>

        <div
          role="img"
          aria-label={`Audio-Cache: ${formatBytes(storage.exclusive_audio_bytes)} exklusiv, ${formatBytes(storage.shared_audio_bytes)} geteilt, ${formatBytes(storage.unattributed_audio_bytes)} unzugeordnet`}
          className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
        >
          {shares.exclusivePct > 0 && (
            <span
              className="block h-full bg-accent"
              style={{ width: `${shares.exclusivePct}%` }}
            />
          )}
          {shares.sharedPct > 0 && (
            <span
              className="block h-full bg-foreground/55"
              style={{ width: `${shares.sharedPct}%` }}
            />
          )}
          {shares.unattributedPct > 0 && (
            <span
              className="block h-full bg-white/20"
              style={{ width: `${shares.unattributedPct}%` }}
            />
          )}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[2px] bg-accent" />
            <div className="min-w-0">
              <dt className="label-mono">Exklusiv (1 Nutzer)</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                {formatBytes(storage.exclusive_audio_bytes)}{" "}
                <span className="font-normal text-muted">
                  ({formatCount(storage.exclusive_audio_tracks)} Titel · {Math.round(shares.exclusivePct)} %)
                </span>
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[2px] bg-foreground/55" />
            <div className="min-w-0">
              <dt className="label-mono">Geteilt (≥ 2 Nutzer)</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                {formatBytes(storage.shared_audio_bytes)}{" "}
                <span className="font-normal text-muted">
                  ({formatCount(storage.shared_audio_tracks)} Titel · {Math.round(shares.sharedPct)} %)
                </span>
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[2px] bg-white/20" />
            <div className="min-w-0">
              <dt className="label-mono">Unzugeordnet</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                {formatBytes(storage.unattributed_audio_bytes)}{" "}
                <span className="font-normal text-muted">
                  ({formatCount(storage.unattributed_audio_tracks)} Titel · {Math.round(shares.unattributedPct)} %)
                </span>
              </dd>
            </div>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hairline pt-3 text-xs text-muted">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 tabular-nums">
            <span>
              Direkt zugeordnet:{" "}
              <strong className="font-semibold text-foreground">
                {formatBytes(storage.directly_attributed_bytes)}
              </strong>{" "}
              ({formatCount(storage.directly_attributed_tracks)} Titel)
            </span>
            <span>
              Uploads (Avatare &amp; Cover):{" "}
              <strong className="font-semibold text-foreground">
                {formatBytes(storage.upload_bytes)}
              </strong>
            </span>
          </div>
          <span className="font-mono text-[11px] text-subtle">
            {trackingDate
              ? `Anfragen erfasst seit ${trackingDate}`
              : "Anfrage-Tracking aktiv ab erstem Abruf"}
          </span>
        </div>
      </section>
    </section>
  );
}
