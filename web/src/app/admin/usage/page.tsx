"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import EmptyState from "@/components/ui/EmptyState";
import { ChevronLeftIcon, LockIcon, RefreshIcon, SearchIcon } from "@/components/icons";
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

function UsagePageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-6">
      <p className="label-mono">{label}…</p>
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

function AdminUsageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = parseUsageRange(searchParams.get("range"));
  const selectedUserId = searchParams.get("user") || null;

  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<UsageSortKey>("plays");
  const [sortDir, setSortDir] = useState<UsageSortDirection>("desc");

  const auth = useQuery({
    queryKey: ["admin-usage-auth"],
    queryFn: api.me,
    retry: false,
    staleTime: 60_000,
  });
  const me = auth.data;

  const usageQuery = useQuery<AdminUsageOverviewResponse>({
    queryKey: ["admin-usage", range],
    queryFn: async () => decodeAdminUsageOverview(await api.adminUsage(range)),
    enabled: !!me?.is_admin,
  });

  const data = usageQuery.data;
  const visibleUsers = useMemo(
    () => (data ? filterAndSortUsers(data.users, searchQuery, sortKey, sortDir) : []),
    [data, searchQuery, sortKey, sortDir],
  );

  function updateParams(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    const qs = params.toString();
    router.replace(qs ? `/admin/usage?${qs}` : "/admin/usage", { scroll: false });
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

  if (auth.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl min-w-0">
        <UsagePageSkeleton label="Berechtigung wird geprüft" />
      </div>
    );
  }

  if (auth.error) {
    return (
      <section role="alert" className="mx-auto w-full max-w-6xl min-w-0">
        <p className="flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-danger">
          <span aria-hidden="true" className="inline-block h-2 w-2 rotate-45 rounded-[1px] bg-danger" />
          Fehler
        </p>
        <h1 className="mt-3 text-[clamp(1.75rem,4.6vw,3rem)] font-extrabold leading-none tracking-[-0.04em] [overflow-wrap:anywhere]">
          Berechtigung konnte nicht geprüft werden
        </h1>
        <p className="error-panel mt-5 max-w-2xl [overflow-wrap:anywhere]">{auth.error.message}</p>
        <button
          type="button"
          onClick={() => void auth.refetch()}
          disabled={auth.isFetching}
          className="action-secondary mt-5"
        >
          {auth.isFetching ? "Wird erneut geprüft…" : "Erneut prüfen"}
        </button>
      </section>
    );
  }

  if (!me?.is_admin) {
    return (
      <EmptyState
        className="mx-auto max-w-xl"
        icon={<LockIcon />}
        title="Nur für Administratoren"
        action={
          <Link href="/" className="action-primary">
            Zur Startseite
          </Link>
        }
      >
        Das Nutzungs-Dashboard ist ausschließlich für Administratoren zugänglich.
      </EmptyState>
    );
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
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6" aria-busy={usageQuery.isFetching}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/account?tab=admin"
          className="label-mono inline-flex min-h-11 items-center gap-1.5 transition-colors hover:text-foreground motion-reduce:transition-none"
        >
          <ChevronLeftIcon width={14} height={14} /> Verwaltung
        </Link>
        <Link href="/status" className="section-link inline-flex min-h-11 items-center">
          Systemstatus
        </Link>
      </div>

      <header className="page-header mb-0">
        <div className="min-w-0">
          <p className="page-eyebrow">Administration</p>
          <h1 className="page-title">Nutzungs-Dashboard</h1>
          <p className="page-description">
            Wiedergaben, Hörzeit, angeforderte Titel und Audio-Cache-Speicher pro Benutzer auf einen Blick.
          </p>
        </div>

        <div className="flex items-center gap-5 max-sm:w-full max-sm:justify-between">
          <p aria-live="polite" className="min-w-0 sm:text-right">
            <span className="label-mono block">
              {usageQuery.isFetching ? "Status" : "Zuletzt aktualisiert"}
            </span>
            <strong className="mt-1 block font-mono text-sm font-medium tabular-nums text-foreground">
              {usageQuery.isFetching ? "Wird aktualisiert…" : (updatedAt ?? "Noch keine Daten")}
            </strong>
          </p>
          <button
            type="button"
            onClick={() => void usageQuery.refetch()}
            disabled={usageQuery.isFetching}
            className="action-secondary"
          >
            <RefreshIcon
              width={16}
              height={16}
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

      {usageQuery.isLoading && <UsagePageSkeleton label="Nutzungsdaten werden geladen" />}

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
            <h2 className="font-display text-xl font-extrabold tracking-[-0.03em]">
              Benutzer ({countFormatter.format(visibleUsers.length)}
              {visibleUsers.length !== data.users.length
                ? ` von ${countFormatter.format(data.users.length)}`
                : ""}
              )
            </h2>
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

export default function AdminUsagePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl min-w-0">
          <UsagePageSkeleton label="Nutzungs-Dashboard wird geladen" />
        </div>
      }
    >
      <AdminUsageContent />
    </Suspense>
  );
}
