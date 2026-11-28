"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { RefreshIcon, SearchIcon } from "@/components/icons";
import {
  decodeAdminUsageOverview,
  filterAndSortUsers,
  parseUsageRange,
  USAGE_RANGE_LABELS,
  USAGE_RANGES,
  USAGE_SORT_LABELS,
  userDisplayName,
  type UsageSortDirection,
  type UsageSortKey,
} from "@/lib/adminUsage";
import type { AdminUsageOverviewResponse, AdminUsageRange } from "@/types";
import UsageOverviewKpis from "./UsageOverviewKpis";
import UserUsageTable from "./UserUsageTable";
import UserUsageDrawer from "./UserUsageDrawer";

const timeFormatter = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const countFormatter = new Intl.NumberFormat("de-DE");

const SORT_OPTIONS: readonly UsageSortKey[] = [
  "plays",
  "listening_sec",
  "tracks_requested",
  "exclusive_bytes",
  "accessed_bytes",
  "last_active_at",
];

function UsageSkeleton() {
  return (
    <div role="status" aria-label="Nutzungsdaten werden geladen" className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className="skeleton block h-28 rounded-[var(--radius-panel)]" />
        ))}
      </div>
      <span className="skeleton block h-40 rounded-[var(--radius-panel)]" />
      <span className="skeleton block h-72 rounded-[var(--radius-panel)]" />
    </div>
  );
}

/** "Nutzung" admin section: KPIs, Audio-Cache distribution, per-user table & drill-down drawer. */
export default function UsageSection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = parseUsageRange(searchParams.get("range"));
  const selectedUserId = searchParams.get("user") || null;

  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<UsageSortKey>("plays");
  const [sortDir, setSortDir] = useState<UsageSortDirection>("desc");

  const usageQuery = useQuery<AdminUsageOverviewResponse>({
    queryKey: ["admin-usage", range],
    queryFn: async () => decodeAdminUsageOverview(await api.adminUsage(range)),
  });

  const data = usageQuery.data;
  const visibleUsers = useMemo(
    () => (data ? filterAndSortUsers(data.users, searchQuery, sortKey, sortDir) : []),
    [data, searchQuery, sortKey, sortDir],
  );

  function updateParams(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "admin");
    params.set("section", "usage");
    mutator(params);
    router.replace(`/account?${params.toString()}`, { scroll: false });
  }

  function selectRange(next: AdminUsageRange) {
    updateParams((params) => {
      params.set("range", next);
    });
  }

  function selectUser(userId: string | null) {
    updateParams((params) => {
      if (userId) params.set("user", userId);
      else params.delete("user");
    });
  }

  function handleSort(column: UsageSortKey) {
    if (sortKey === column) {
      setSortDir((current) => (current === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(column);
      setSortDir("desc");
    }
  }

  const updatedAt =
    data && usageQuery.dataUpdatedAt > 0
      ? timeFormatter.format(new Date(usageQuery.dataUpdatedAt))
      : data
        ? timeFormatter.format(new Date(data.generated_at))
        : null;

  const selectedSummary = selectedUserId
    ? data?.users.find((u) => u.id === selectedUserId)
    : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-5" aria-busy={usageQuery.isFetching}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-extrabold tracking-[-0.03em]">
            Nutzungsübersicht
          </h2>
          <p className="mt-1 text-sm text-muted">
            Wiedergaben, Hörzeit, angeforderte Titel und Audio-Cache-Speicher pro Benutzer.
          </p>
        </div>

        <div className="flex items-center gap-4 max-sm:w-full max-sm:justify-between">
          <p aria-live="polite" className="min-w-0 sm:text-right">
            <span className="label-mono block">
              {usageQuery.isFetching ? "Status" : "Zuletzt aktualisiert"}
            </span>
            <strong className="mt-0.5 block font-mono text-xs font-medium tabular-nums text-foreground">
              {usageQuery.isFetching ? "Wird aktualisiert…" : (updatedAt ?? "Noch keine Daten")}
            </strong>
          </p>
          <button
            type="button"
            onClick={() => void usageQuery.refetch()}
            disabled={usageQuery.isFetching}
            className="action-secondary min-h-10 px-3.5 text-xs"
          >
            <RefreshIcon
              width={15}
              height={15}
              className={usageQuery.isFetching ? "animate-spin motion-reduce:animate-none" : ""}
            />
            Aktualisieren
          </button>
        </div>
      </header>

      {/* Controls: timeframe switcher, user search, sort */}
      <section
        aria-label="Filter und Sortierung"
        className="flex flex-wrap items-center justify-between gap-3 border-y border-hairline py-3.5"
      >
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Zeitraum">
          {USAGE_RANGES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={range === item}
              onClick={() => selectRange(item)}
              className="filter-chip max-sm:min-h-11"
            >
              {USAGE_RANGE_LABELS[item]}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-initial">
          <div className="relative min-w-[200px] flex-1 sm:w-60 sm:flex-initial">
            <SearchIcon
              aria-hidden="true"
              width={15}
              height={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Name oder E-Mail suchen…"
              aria-label="Benutzer nach Name oder E-Mail filtern"
              className="field-input min-h-10 py-1.5 pl-9 pr-3 text-sm"
            />
          </div>

          <label className="flex items-center gap-2">
            <span className="sr-only">Sortieren nach</span>
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as UsageSortKey)}
              aria-label="Sortieren nach"
              className="field-input min-h-10 w-auto py-1.5 pl-3 pr-8 text-sm"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option} value={option} className="bg-panel text-foreground">
                  {USAGE_SORT_LABELS[option]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => setSortDir((current) => (current === "desc" ? "asc" : "desc"))}
            aria-label={
              sortDir === "desc"
                ? "Absteigend sortiert — aufsteigend sortieren"
                : "Aufsteigend sortiert — absteigend sortieren"
            }
            title={sortDir === "desc" ? "Absteigend" : "Aufsteigend"}
            className="action-secondary min-h-10 px-3 font-mono text-xs"
          >
            {sortDir === "desc" ? "↓ Abst." : "↑ Aufst."}
          </button>
        </div>
      </section>

      {usageQuery.isLoading && <UsageSkeleton />}

      {usageQuery.error && (
        <div role="alert" className="error-panel flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-danger">
              <span aria-hidden="true" className="inline-block h-2 w-2 rotate-45 rounded-[1px] bg-danger" />
              {data ? "Daten veraltet" : "Keine Daten"}
            </p>
            <strong className="mt-2 block text-base font-semibold text-foreground">
              {data
                ? "Die Nutzungsdaten konnten nicht aktualisiert werden."
                : "Die Nutzungsdaten konnten nicht geladen werden."}
            </strong>
            <p className="mt-1 [overflow-wrap:anywhere]">{usageQuery.error.message}</p>
          </div>
          <button
            type="button"
            onClick={() => void usageQuery.refetch()}
            disabled={usageQuery.isFetching}
            className="action-secondary"
          >
            {usageQuery.isFetching ? "Wird geladen…" : "Erneut versuchen"}
          </button>
        </div>
      )}

      {data && (
        <>
          <UsageOverviewKpis
            overview={data.overview}
            range={data.range}
            requestTrackingSince={data.request_tracking_since}
          />

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-xl font-extrabold tracking-[-0.03em]">
              Benutzer ({countFormatter.format(visibleUsers.length)}
              {visibleUsers.length !== data.users.length
                ? ` von ${countFormatter.format(data.users.length)}`
                : ""}
              )
            </h3>
            <p className="label-mono">Klicke auf einen Benutzer für Details</p>
          </div>

          <UserUsageTable
            users={visibleUsers}
            totalUsersCount={data.users.length}
            totalCacheBytes={data.overview.storage.total_audio_bytes}
            selectedUserId={selectedUserId}
            sortKey={sortKey}
            sortDir={sortDir}
            searchQuery={searchQuery}
            onSort={handleSort}
            onSelectUser={(id) => selectUser(id)}
            onResetSearch={() => setSearchQuery("")}
          />
        </>
      )}

      <UserUsageDrawer
        userId={selectedUserId}
        selectedUserName={selectedSummary ? userDisplayName(selectedSummary) : undefined}
        range={range}
        onClose={() => selectUser(null)}
      />
    </div>
  );
}
