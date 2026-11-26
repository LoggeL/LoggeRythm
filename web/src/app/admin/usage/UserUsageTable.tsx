import Avatar from "@/components/Avatar";
import EqualizerBars from "@/components/EqualizerBars";
import EmptyState from "@/components/ui/EmptyState";
import { ChevronRightIcon, UsersIcon } from "@/components/icons";
import { Badge } from "@/app/account/presentation";
import {
  computeUserStorageShares,
  formatBytes,
  formatDuration,
  formatFullDateTime,
  formatRelativeTimestamp,
  userDisplayName,
  type UsageSortDirection,
  type UsageSortKey,
} from "@/lib/adminUsage";
import type { AdminUserUsageSummary } from "@/types";

const countFormatter = new Intl.NumberFormat("de-DE");
const formatCount = (value: number) => countFormatter.format(value);

function SortButton({
  label,
  column,
  activeKey,
  direction,
  onSort,
  align = "right",
}: {
  label: string;
  column: UsageSortKey;
  activeKey: UsageSortKey;
  direction: UsageSortDirection;
  onSort: (key: UsageSortKey) => void;
  align?: "left" | "right";
}) {
  const active = activeKey === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={`label-mono inline-flex items-center gap-1 transition-colors hover:text-foreground ${
        align === "right" ? "ml-auto justify-end" : ""
      } ${active ? "text-accent-soft" : ""}`}
    >
      <span>{label}</span>
      <span aria-hidden="true" className="text-[10px]">
        {active ? (direction === "desc" ? "↓" : "↑") : "↕"}
      </span>
    </button>
  );
}

function LivePresenceBadge({ user }: { user: AdminUserUsageSummary }) {
  if (user.online_devices === 0 && !user.active_party_code) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {user.online_devices > 0 && (
        <span
          title={user.active_device_name ?? undefined}
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium ${
            user.is_playing_now
              ? "bg-accent/15 text-accent-soft"
              : "bg-success/12 text-success"
          }`}
        >
          {user.is_playing_now ? (
            <EqualizerBars height={10} isPlaying />
          ) : (
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
          )}
          <span className="max-w-36 truncate">
            {user.is_playing_now
              ? user.active_device_name || "Spielt"
              : `${user.online_devices} online`}
          </span>
        </span>
      )}
      {user.active_party_code && (
        <span className="inline-flex items-center rounded-full bg-white/[0.07] px-2 py-0.5 font-mono text-[10.5px] font-medium text-muted">
          Jam {user.active_party_code}
        </span>
      )}
    </div>
  );
}

function StorageMeter({
  user,
  totalCacheBytes,
}: {
  user: AdminUserUsageSummary;
  totalCacheBytes: number;
}) {
  const shares = computeUserStorageShares(user.storage, totalCacheBytes);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs tabular-nums">
        <strong className="font-semibold text-foreground">
          {formatBytes(user.storage.exclusive_bytes)}{" "}
          <span className="font-normal text-muted">exkl.</span>
        </strong>
        <span className="text-muted">
          {formatBytes(user.storage.accessed_bytes)} gesamt
        </span>
      </div>
      <div
        aria-hidden="true"
        className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
      >
        {shares.accessedPct > 0 && (
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-foreground/35"
            style={{ width: `${Math.max(2, shares.accessedPct)}%` }}
          />
        )}
        {shares.exclusivePct > 0 && (
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: `${Math.max(2, shares.exclusivePct)}%` }}
          />
        )}
      </div>
      <p className="mt-1 truncate text-[11px] tabular-nums text-subtle">
        {formatBytes(user.storage.pinned_bytes)} geschützt ·{" "}
        {formatBytes(user.storage.materialized_bytes)} geladen
        {user.storage.upload_bytes > 0
          ? ` · +${formatBytes(user.storage.upload_bytes)} Uploads`
          : ""}
      </p>
    </div>
  );
}

export default function UserUsageTable({
  users,
  totalUsersCount,
  totalCacheBytes,
  selectedUserId,
  sortKey,
  sortDir,
  searchQuery,
  onSort,
  onSelectUser,
  onResetSearch,
}: {
  users: readonly AdminUserUsageSummary[];
  totalUsersCount: number;
  totalCacheBytes: number;
  selectedUserId: string | null;
  sortKey: UsageSortKey;
  sortDir: UsageSortDirection;
  searchQuery: string;
  onSort: (key: UsageSortKey) => void;
  onSelectUser: (userId: string) => void;
  onResetSearch: () => void;
}) {
  if (totalUsersCount === 0) {
    return (
      <EmptyState icon={<UsersIcon />} title="Noch keine Benutzer">
        Sobald sich Benutzer anmelden und Musik hören, erscheint hier ihre Nutzung.
      </EmptyState>
    );
  }

  if (users.length === 0) {
    return (
      <EmptyState
        icon={<UsersIcon />}
        title={`Keine Benutzer passen zu „${searchQuery.trim()}“`}
        action={
          <button type="button" onClick={onResetSearch} className="action-secondary">
            Filter zurücksetzen
          </button>
        }
      />
    );
  }

  const ariaSortFor = (...columns: UsageSortKey[]): "ascending" | "descending" | "none" =>
    columns.includes(sortKey) ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  return (
    <section aria-label="Nutzung pro Benutzer" className="flex flex-col gap-3">
      {/* Desktop sortable table */}
      <div className="surface-card hidden overflow-x-auto lg:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline bg-white/[0.02]">
              <th scope="col" className="py-3 pl-5 pr-3">
                <span className="label-mono">Benutzer</span>
              </th>
              <th scope="col" aria-sort={ariaSortFor("last_active_at")} className="px-3 py-3 text-right">
                <SortButton
                  label="Zuletzt aktiv"
                  column="last_active_at"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
              </th>
              <th scope="col" aria-sort={ariaSortFor("plays", "listening_sec")} className="px-3 py-3 text-right">
                <div className="flex flex-col items-end gap-0.5">
                  <SortButton
                    label="Wiedergaben"
                    column="plays"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                  />
                  <SortButton
                    label="Hörzeit"
                    column="listening_sec"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                  />
                </div>
              </th>
              <th scope="col" aria-sort={ariaSortFor("tracks_requested")} className="px-3 py-3 text-right">
                <SortButton
                  label="Angefordert"
                  column="tracks_requested"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={onSort}
                />
              </th>
              <th scope="col" aria-sort={ariaSortFor("exclusive_bytes", "accessed_bytes")} className="min-w-[230px] px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <SortButton
                    label="Speicher exkl."
                    column="exclusive_bytes"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                    align="left"
                  />
                  <SortButton
                    label="Gesamt"
                    column="accessed_bytes"
                    activeKey={sortKey}
                    direction={sortDir}
                    onSort={onSort}
                  />
                </div>
              </th>
              <th scope="col" className="py-3 pl-3 pr-5 text-right">
                <span className="label-mono">Bibliothek &amp; Jam</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const selected = selectedUserId === user.id;
              const name = userDisplayName(user);
              return (
                <tr
                  key={user.id}
                  onClick={() => onSelectUser(user.id)}
                  className={`group cursor-pointer border-t border-hairline transition-colors first:border-t-0 ${
                    selected
                      ? "bg-accent/[0.07]"
                      : "hover:bg-white/[0.03]"
                  }`}
                >
                  <td className={`py-3.5 pl-5 pr-3 align-top ${selected ? "shadow-[inset_3px_0_0_var(--accent)]" : ""}`}>
                    <div className="flex items-start gap-3">
                      <Avatar src={user.avatar_url} name={name} size={38} className="mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectUser(user.id);
                            }}
                            aria-label={`Details für ${name} öffnen`}
                            aria-expanded={selected}
                            className="truncate text-left text-sm font-semibold text-foreground group-hover:text-accent-soft"
                          >
                            {name}
                          </button>
                          {user.is_admin && <Badge tone="accent">Admin</Badge>}
                          {!user.is_approved && <Badge tone="warning">Wartet</Badge>}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted">{user.email}</p>
                        <LivePresenceBadge user={user} />
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-3.5 text-right align-top">
                    <span
                      title={formatFullDateTime(user.last_active_at)}
                      className="block text-sm font-medium tabular-nums text-foreground"
                    >
                      {formatRelativeTimestamp(user.last_active_at)}
                    </span>
                    {user.created_at && (
                      <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-subtle">
                        seit {new Date(user.created_at).toLocaleDateString("de-DE")}
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-3.5 text-right align-top tabular-nums">
                    <span className="block text-sm font-bold text-foreground">
                      {formatCount(user.plays)}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {formatDuration(user.listening_sec)}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-subtle">
                      {formatCount(user.unique_tracks)} Titel
                    </span>
                  </td>

                  <td className="px-3 py-3.5 text-right align-top tabular-nums">
                    <span className="block text-sm font-bold text-foreground">
                      {formatCount(user.tracks_requested)}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {formatCount(user.tracks_materialized)} neu geladen
                    </span>
                    <span className="mt-0.5 block text-[11px] text-subtle">
                      {formatBytes(user.materialized_bytes)}
                    </span>
                  </td>

                  <td className="px-3 py-3.5 align-top">
                    <StorageMeter user={user} totalCacheBytes={totalCacheBytes} />
                  </td>

                  <td className="py-3.5 pl-3 pr-5 text-right align-top">
                    <div className="flex items-start justify-end gap-2">
                      <div className="text-right text-xs tabular-nums text-muted">
                        <p>
                          <strong className="font-semibold text-foreground">
                            {formatCount(user.library.likes)}
                          </strong>{" "}
                          Likes ·{" "}
                          <strong className="font-semibold text-foreground">
                            {formatCount(user.library.playlists)}
                          </strong>{" "}
                          Pl.
                        </p>
                        <p className="mt-0.5 text-[11px] text-subtle">
                          {formatCount(user.library.party_tracks_added)} Jam ·{" "}
                          {formatCount(user.library.import_jobs)} Imports
                        </p>
                      </div>
                      <ChevronRightIcon
                        aria-hidden="true"
                        width={16}
                        height={16}
                        className="mt-0.5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile & tablet card stack */}
      <ul className="flex flex-col gap-3 lg:hidden">
        {users.map((user) => {
          const selected = selectedUserId === user.id;
          const name = userDisplayName(user);
          return (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => onSelectUser(user.id)}
                aria-expanded={selected}
                className={`surface-card block w-full p-4 text-left transition-colors hover:bg-panel-hover ${
                  selected ? "border-accent/50 bg-accent/[0.06]" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar src={user.avatar_url} name={name} size={40} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {name}
                        </span>
                        {user.is_admin && <Badge tone="accent">Admin</Badge>}
                        {!user.is_approved && <Badge tone="warning">Wartet</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">{user.email}</p>
                      <LivePresenceBadge user={user} />
                    </div>
                  </div>
                  <ChevronRightIcon aria-hidden="true" width={18} height={18} className="mt-1 shrink-0 text-muted" />
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-3 text-xs tabular-nums">
                  <div>
                    <dt className="label-mono">Wiedergaben</dt>
                    <dd className="mt-1 font-semibold text-foreground">
                      {formatCount(user.plays)} · {formatDuration(user.listening_sec)}
                    </dd>
                    <dd className="text-[11px] text-subtle">{formatCount(user.unique_tracks)} Titel</dd>
                  </div>
                  <div>
                    <dt className="label-mono">Angefordert</dt>
                    <dd className="mt-1 font-semibold text-foreground">
                      {formatCount(user.tracks_requested)} ({formatCount(user.tracks_materialized)} neu)
                    </dd>
                    <dd className="text-[11px] text-subtle">{formatBytes(user.materialized_bytes)}</dd>
                  </div>
                </dl>

                <div className="mt-3 border-t border-hairline pt-3">
                  <span className="label-mono mb-1 block">Speicher im Auftrag</span>
                  <StorageMeter user={user} totalCacheBytes={totalCacheBytes} />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2.5 text-[11px] tabular-nums text-muted">
                  <span>
                    {formatCount(user.library.likes)} Likes · {formatCount(user.library.playlists)} Playlists ·{" "}
                    {formatCount(user.library.party_tracks_added)} Jam
                  </span>
                  <span title={formatFullDateTime(user.last_active_at)}>
                    Aktiv: {formatRelativeTimestamp(user.last_active_at)}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
