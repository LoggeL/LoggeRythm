"use client";

import Link from "next/link";
import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import Avatar from "@/components/Avatar";
import Cover from "@/components/ui/Cover";
import EqualizerBars from "@/components/EqualizerBars";
import {
  CloseIcon,
  DevicesIcon,
  LaptopIcon,
  PhoneIcon,
  RefreshIcon,
  SpeakerIcon,
  TabletIcon,
  TvIcon,
} from "@/components/icons";
import { Badge } from "@/app/account/presentation";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { api } from "@/lib/api";
import {
  computeUserStorageShares,
  decodeAdminUserUsageDetail,
  formatBytes,
  formatDuration,
  formatFullDateTime,
  formatRelativeTimestamp,
  TRACK_REQUEST_SOURCE_LABELS,
  USAGE_RANGE_LABELS,
  userDisplayName,
} from "@/lib/adminUsage";
import { formatTime } from "@/lib/format";
import type {
  AdminConnectDevice,
  AdminUsageRange,
  AdminUserUsageDetailResponse,
  DeviceType,
  StatEntry,
} from "@/types";

const countFormatter = new Intl.NumberFormat("de-DE");
const formatCount = (value: number) => countFormatter.format(value);

function DeviceTypeIcon({ type }: { type: DeviceType }) {
  switch (type) {
    case "mobile":
      return <PhoneIcon width={16} height={16} />;
    case "tablet":
      return <TabletIcon width={16} height={16} />;
    case "tv":
      return <TvIcon width={16} height={16} />;
    case "speaker":
      return <SpeakerIcon width={16} height={16} />;
    case "desktop":
    case "web":
      return <LaptopIcon width={16} height={16} />;
    default:
      return <DevicesIcon width={16} height={16} />;
  }
}

function DrawerSkeleton() {
  return (
    <div role="status" aria-label="Benutzerdetails werden geladen" className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <span key={index} className="skeleton block h-16 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <span className="skeleton block h-36 rounded-[var(--radius-panel)]" />
      <span className="skeleton block h-28 rounded-[var(--radius-panel)]" />
      <span className="skeleton block h-44 rounded-[var(--radius-panel)]" />
    </div>
  );
}

function MiniRanking({
  title,
  entries,
  artwork = false,
}: {
  title: string;
  entries: readonly StatEntry[];
  artwork?: boolean;
}) {
  const max = entries.length > 0 ? Math.max(...entries.map((entry) => entry.count)) : 0;
  return (
    <section className="min-w-0" aria-label={title}>
      <h3 className="label-mono border-b border-hairline pb-2">{title}</h3>
      {entries.length === 0 ? (
        <p className="py-3 text-xs text-muted">Keine Wiedergaben in diesem Zeitraum.</p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry, index) => (
            <li
              key={`${entry.key}-${index}`}
              className="flex min-w-0 items-center gap-2.5 border-b border-hairline py-2 last:border-b-0"
            >
              <span aria-hidden="true" className="w-5 shrink-0 font-mono text-[11px] tabular-nums text-subtle">
                {String(index + 1).padStart(2, "0")}
              </span>
              {artwork && <Cover src={entry.cover} className="h-8 w-8 rounded-art" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-foreground">{entry.label}</p>
                {entry.sublabel && <p className="truncate text-[11px] text-muted">{entry.sublabel}</p>}
                <div aria-hidden="true" className="mt-1 h-0.5 overflow-hidden bg-foreground/[0.08]">
                  <span
                    className="block h-full bg-foreground/55"
                    style={{ width: `${max > 0 ? (entry.count / max) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-foreground">
                {formatCount(entry.count)}×
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function DeviceRow({ device, isPlayingNow }: { device: AdminConnectDevice; isPlayingNow: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
            device.is_active ? "bg-accent/15 text-accent-soft" : "bg-white/[0.06] text-muted"
          }`}
        >
          <DeviceTypeIcon type={device.device_type} />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="truncate">{device.name}</span>
            {device.is_active && isPlayingNow && <EqualizerBars height={11} isPlaying />}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-subtle">
            {device.device_type} · gesehen {formatRelativeTimestamp(device.last_seen_at)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {device.is_active && <Badge tone="accent">Aktiv</Badge>}
        {device.party_code && <Badge tone="neutral">Jam {device.party_code}</Badge>}
      </div>
    </li>
  );
}

function DetailBody({ detail }: { detail: AdminUserUsageDetailResponse }) {
  const { user, storage_breakdown: storage } = detail;
  const shares = computeUserStorageShares(storage, storage.total_cache_bytes);
  const trackingDate = formatFullDateTime(detail.request_tracking_since);

  return (
    <div className="flex flex-col gap-6">
      {/* Activity summary strip */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-[var(--radius-card)] border border-hairline bg-white/[0.02] p-3">
          <dt className="label-mono">Wiedergaben</dt>
          <dd className="mt-1 font-display text-xl font-extrabold tabular-nums text-foreground">
            {formatCount(user.plays)}
          </dd>
          <dd className="mt-0.5 text-[11px] text-muted">{formatCount(user.unique_tracks)} Titel</dd>
        </div>
        <div className="rounded-[var(--radius-card)] border border-hairline bg-white/[0.02] p-3">
          <dt className="label-mono">Hörzeit</dt>
          <dd className="mt-1 font-display text-xl font-extrabold tabular-nums text-foreground">
            {formatDuration(user.listening_sec)}
          </dd>
          <dd className="mt-0.5 text-[11px] text-muted">Zeitraum: {USAGE_RANGE_LABELS[detail.range]}</dd>
        </div>
        <div className="rounded-[var(--radius-card)] border border-hairline bg-white/[0.02] p-3">
          <dt className="label-mono">Angefordert</dt>
          <dd className="mt-1 font-display text-xl font-extrabold tabular-nums text-foreground">
            {formatCount(user.tracks_requested)}
          </dd>
          <dd className="mt-0.5 text-[11px] text-muted">
            {formatCount(user.tracks_materialized)} neu geladen
          </dd>
        </div>
        <div className="rounded-[var(--radius-card)] border border-hairline bg-white/[0.02] p-3">
          <dt className="label-mono">Zuletzt aktiv</dt>
          <dd
            title={formatFullDateTime(user.last_active_at)}
            className="mt-1 font-display text-lg font-extrabold tabular-nums text-foreground"
          >
            {formatRelativeTimestamp(user.last_active_at)}
          </dd>
          {user.created_at && (
            <dd className="mt-0.5 text-[11px] text-muted">
              Mitglied seit {new Date(user.created_at).toLocaleDateString("de-DE")}
            </dd>
          )}
        </div>
      </dl>

      {/* Storage attribution breakdown */}
      <section aria-labelledby="drawer-storage-title" className="rounded-[var(--radius-panel)] border border-hairline bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="drawer-storage-title" className="font-display text-base font-bold">
            Speicher im Auftrag
          </h3>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {Math.round(shares.accessedPct)} % von {formatBytes(storage.total_cache_bytes)} Cache
          </span>
        </div>

        <div
          role="img"
          aria-label={`Speicheranteil: ${formatBytes(storage.exclusive_bytes)} exklusiv, ${formatBytes(storage.shared_bytes)} geteilt`}
          className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-white/[0.08]"
        >
          {shares.exclusivePct > 0 && (
            <span className="block h-full bg-accent" style={{ width: `${shares.exclusivePct}%` }} />
          )}
          {shares.sharedPct > 0 && (
            <span className="block h-full bg-foreground/50" style={{ width: `${shares.sharedPct}%` }} />
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs tabular-nums sm:grid-cols-3">
          <div>
            <dt className="label-mono flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-[2px] bg-accent" />
              Exklusiv
            </dt>
            <dd className="mt-1 font-semibold text-foreground">{formatBytes(storage.exclusive_bytes)}</dd>
            <dd className="text-[11px] text-subtle">{formatCount(storage.exclusive_tracks)} Titel</dd>
          </div>
          <div>
            <dt className="label-mono flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-[2px] bg-foreground/50" />
              Geteilt
            </dt>
            <dd className="mt-1 font-semibold text-foreground">{formatBytes(storage.shared_bytes)}</dd>
            <dd className="text-[11px] text-subtle">{formatCount(storage.shared_tracks)} Titel</dd>
          </div>
          <div>
            <dt className="label-mono">Zugegriffen</dt>
            <dd className="mt-1 font-semibold text-foreground">{formatBytes(storage.accessed_bytes)}</dd>
            <dd className="text-[11px] text-subtle">{formatCount(storage.accessed_tracks)} Titel</dd>
          </div>
          <div>
            <dt className="label-mono">Neu geladen</dt>
            <dd className="mt-1 font-semibold text-foreground">{formatBytes(storage.materialized_bytes)}</dd>
            <dd className="text-[11px] text-subtle">{formatCount(storage.materialized_tracks)} im Cache</dd>
          </div>
          <div>
            <dt className="label-mono">Geschützt</dt>
            <dd className="mt-1 font-semibold text-foreground">{formatBytes(storage.pinned_bytes)}</dd>
            <dd className="text-[11px] text-subtle">{formatCount(storage.pinned_tracks)} Likes/Pl.</dd>
          </div>
          <div>
            <dt className="label-mono">Uploads</dt>
            <dd className="mt-1 font-semibold text-foreground">{formatBytes(storage.upload_bytes)}</dd>
            <dd className="text-[11px] text-subtle">Avatar &amp; Cover</dd>
          </div>
        </dl>
      </section>

      {/* Active Connect devices */}
      <section aria-labelledby="drawer-devices-title" className="rounded-[var(--radius-panel)] border border-hairline bg-white/[0.02] p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 id="drawer-devices-title" className="font-display text-base font-bold">
            Aktive Connect-Geräte
          </h3>
          <span className="label-mono">{formatCount(detail.active_devices.length)} verbunden</span>
        </div>
        {detail.active_devices.length > 0 && (
          <ul className="mt-3 flex flex-col">
            {detail.active_devices.map((device) => (
              <DeviceRow
                key={device.device_id}
                device={device}
                isPlayingNow={user.is_playing_now}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Requests by source */}
      <section aria-labelledby="drawer-sources-title" className="rounded-[var(--radius-panel)] border border-hairline bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="drawer-sources-title" className="font-display text-base font-bold">
            Anfragen nach Quelle
          </h3>
          {trackingDate && (
            <span className="font-mono text-[10.5px] text-subtle">seit {trackingDate}</span>
          )}
        </div>
        {detail.requests_by_source.length === 0 ? (
          <p className="mt-2.5 text-xs text-muted">
            In diesem Zeitraum wurden noch keine Titel-Anfragen aufgezeichnet.
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {detail.requests_by_source.map((entry) => (
              <li
                key={entry.source}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-hairline px-3 py-2 text-xs tabular-nums"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">
                    {TRACK_REQUEST_SOURCE_LABELS[entry.source]}
                  </p>
                  <p className="text-[11px] text-muted">
                    {formatCount(entry.materialized)} neu geladen ({formatBytes(entry.materialized_bytes)})
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold text-foreground">
                  {formatCount(entry.requests)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Library & Party counters */}
      <section aria-labelledby="drawer-library-title" className="rounded-[var(--radius-panel)] border border-hairline bg-white/[0.02] p-4">
        <h3 id="drawer-library-title" className="font-display text-base font-bold">
          Bibliothek &amp; Aktivität
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs tabular-nums sm:grid-cols-3">
          <div>
            <dt className="label-mono">Likes</dt>
            <dd className="mt-0.5 font-semibold text-foreground">{formatCount(user.library.likes)}</dd>
          </div>
          <div>
            <dt className="label-mono">Playlists</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              {formatCount(user.library.playlists)}{" "}
              <span className="font-normal text-muted">({formatCount(user.library.public_playlists)} öff.)</span>
            </dd>
          </div>
          <div>
            <dt className="label-mono">Playlist-Titel</dt>
            <dd className="mt-0.5 font-semibold text-foreground">{formatCount(user.library.playlist_tracks)}</dd>
          </div>
          <div>
            <dt className="label-mono">Gefolgte Künstler</dt>
            <dd className="mt-0.5 font-semibold text-foreground">{formatCount(user.library.follows)}</dd>
          </div>
          <div>
            <dt className="label-mono">Jam-Aktivität</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              {formatCount(user.library.party_tracks_added)} Titel · {formatCount(user.library.party_hosted)} gehostet
            </dd>
          </div>
          <div>
            <dt className="label-mono">Spotify-Imports</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              {formatCount(user.library.import_jobs)} ({formatCount(user.library.import_tracks_matched)} Titel)
            </dd>
          </div>
        </dl>
      </section>

      {/* Top artists & top tracks */}
      <div className="grid gap-6 sm:grid-cols-2">
        <MiniRanking title="Top-Künstler" entries={detail.top_artists} />
        <MiniRanking title="Top-Titel" entries={detail.top_tracks} artwork />
      </div>

      {/* Recent plays */}
      <section aria-labelledby="drawer-recent-plays-title">
        <h3 id="drawer-recent-plays-title" className="label-mono border-b border-hairline pb-2">
          Zuletzt gehört ({formatCount(detail.recent_plays.length)})
        </h3>
        {detail.recent_plays.length === 0 ? (
          <p className="py-3 text-xs text-muted">Noch keine Wiedergaben in diesem Zeitraum.</p>
        ) : (
          <ol className="flex flex-col">
            {detail.recent_plays.map((track, index) => (
              <li
                key={`${track.id}-${track.played_at}-${index}`}
                className="flex items-center gap-3 border-b border-hairline py-2 last:border-b-0"
              >
                <Cover src={track.cover} className="h-9 w-9 rounded-art" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">{track.title || "Unbenannter Titel"}</p>
                  <p className="truncate text-[11px] text-muted">
                    {track.artist || "Unbekannter Künstler"}
                    {track.album ? ` · ${track.album}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
                  <span className="block" title={formatFullDateTime(track.played_at)}>
                    {formatRelativeTimestamp(track.played_at)}
                  </span>
                  {track.duration_sec > 0 && (
                    <span className="block text-subtle">{formatTime(track.duration_sec)}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Recent requested tracks */}
      <section aria-labelledby="drawer-recent-requests-title">
        <h3 id="drawer-recent-requests-title" className="label-mono border-b border-hairline pb-2">
          Zuletzt angeforderte Titel ({formatCount(detail.recent_requests.length)})
        </h3>
        {detail.recent_requests.length === 0 ? (
          <p className="py-3 text-xs text-muted">Noch keine Titel-Anfragen in diesem Zeitraum.</p>
        ) : (
          <ol className="flex flex-col">
            {detail.recent_requests.map((request, index) => (
              <li
                key={`${request.deezer_id}-${request.requested_at}-${index}`}
                className="flex flex-wrap items-center gap-3 border-b border-hairline py-2.5 last:border-b-0"
              >
                <Cover src={request.cover} className="h-9 w-9 rounded-art" />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-xs font-semibold text-foreground">
                    {request.title || `Titel #${request.deezer_id}`}
                  </p>
                  <p className="truncate text-[11px] text-muted">
                    {request.artist || "Deezer-Titel"} ·{" "}
                    <span className="font-mono text-subtle">
                      {TRACK_REQUEST_SOURCE_LABELS[request.source]}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {request.materialized ? (
                    <Badge tone="accent">Neu geladen</Badge>
                  ) : (
                    <Badge tone="neutral">Cache-Treffer</Badge>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${
                      request.is_currently_stored
                        ? "bg-success/10 text-success"
                        : "bg-white/[0.06] text-subtle"
                    }`}
                  >
                    {request.is_currently_stored ? "Im Cache" : "Entfernt"}
                  </span>
                  <div className="min-w-16 text-right font-mono text-[11px] tabular-nums text-muted">
                    <span className="block" title={formatFullDateTime(request.requested_at)}>
                      {formatRelativeTimestamp(request.requested_at)}
                    </span>
                    {request.size_bytes > 0 && (
                      <span className="block text-subtle">{formatBytes(request.size_bytes)}</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export default function UserUsageDrawer({
  userId,
  selectedUserName,
  range,
  onClose,
}: {
  userId: string | null;
  selectedUserName?: string;
  range: AdminUsageRange;
  onClose: () => void;
}) {
  const open = userId !== null;
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useDialogFocus(open, panelRef, onClose);

  const { data, isLoading, isFetching, error, refetch } = useQuery<AdminUserUsageDetailResponse>({
    queryKey: ["admin-usage-user", userId, range],
    queryFn: async () => {
      if (!userId) throw new Error("Kein Benutzer für die Detailansicht ausgewählt.");
      return decodeAdminUserUsageDetail(await api.adminUsageUser(userId, range));
    },
    enabled: open,
  });

  if (!open) return null;

  const displayName = data ? userDisplayName(data.user) : (selectedUserName ?? "Benutzerdetails");

  const overlay = (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-end bg-backdrop/80 backdrop-blur-xs sm:items-stretch"
      onClick={onClose}
    >
      <aside
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isFetching}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90dvh] w-full flex-col rounded-t-[var(--radius-panel)] border border-hairline bg-panel shadow-[0_24px_60px_rgb(0_0_0/0.6)] outline-none animate-[sheetUp_.28s_var(--ease-out)_both] motion-reduce:animate-none max-sm:border-x-0 max-sm:border-b-0 sm:max-h-none sm:h-full sm:max-w-2xl sm:rounded-none sm:border-y-0 sm:border-r-0 sm:animate-[popIn_.2s_var(--ease-out)_both]"
      >
        <div aria-hidden="true" className="mx-auto mt-2.5 h-[3px] w-8 shrink-0 rounded-full bg-foreground/20 sm:hidden" />

        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-hairline px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            {data && (
              <Avatar src={data.user.avatar_url} name={displayName} size={46} className="mt-0.5" />
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id={titleId}
                  className="font-display truncate text-xl font-extrabold tracking-[-0.03em] text-foreground"
                >
                  {displayName}
                </h2>
                {data?.user.is_admin && <Badge tone="accent">Admin</Badge>}
                {data && !data.user.is_approved && <Badge tone="warning">Wartet</Badge>}
              </div>
              {data && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="truncate">{data.user.email}</span>
                  <Link href={`/users/${encodeURIComponent(data.user.id)}`} className="section-link">
                    Profil
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label="Benutzerdetails aktualisieren"
              title="Aktualisieren"
              className="action-icon h-10 w-10"
            >
              <RefreshIcon
                width={17}
                height={17}
                className={isFetching ? "animate-spin motion-reduce:animate-none" : ""}
              />
            </button>
            <button
              type="button"
              data-dialog-autofocus
              onClick={onClose}
              aria-label="Detailansicht schließen"
              className="action-icon h-10 w-10"
            >
              <CloseIcon width={18} height={18} />
            </button>
          </div>
        </header>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-5 py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6">
          {isLoading && <DrawerSkeleton />}

          {error && (
            <div role="alert" className="error-panel mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-danger">
                  {data ? "Details veraltet" : "Fehler"}
                </p>
                <p className="mt-1 [overflow-wrap:anywhere]">
                  Benutzerdetails konnten nicht geladen werden: {error.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="action-secondary min-h-9 px-4 text-xs"
              >
                {isFetching ? "Wird geladen…" : "Erneut versuchen"}
              </button>
            </div>
          )}

          {data && <DetailBody detail={data} />}
        </div>
      </aside>
    </div>
  );

  // Portal into document.body so ancestor transforms (`.animate-in`) never trap `fixed` layout.
  return typeof document !== "undefined" ? createPortal(overlay, document.body) : overlay;
}
