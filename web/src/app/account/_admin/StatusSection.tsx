"use client";

import { useQuery } from "@tanstack/react-query";
import type { SystemStatus } from "@/types";
import { RefreshIcon } from "./statusIcons";
import { fetchSystemStatus } from "./statusModel";
import { StatusBody } from "./StatusOverview";

const timeFormatter = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function StatusSkeleton() {
  return (
    <div role="status" aria-label="Systemstatus wird geladen" className="flex flex-col gap-10">
      <div>
        <span className="skeleton block h-12 w-full max-w-xl rounded-[var(--radius-card)] sm:h-14" />
        <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <span key={index} className="block border-t-2 border-hairline pt-3">
              <span className="skeleton block h-10 rounded-[var(--radius-card)]" />
            </span>
          ))}
        </div>
      </div>
      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} className="block border-t border-hairline pt-4">
            <span className="skeleton block h-36 rounded-[var(--radius-card)]" />
          </span>
        ))}
      </div>
    </div>
  );
}

/** "Systemstatus" admin section: live diagnostics embedded in the Administration hub. */
export default function StatusSection() {
  const { data: status, dataUpdatedAt, isLoading, isFetching, error, refetch } = useQuery<SystemStatus>({
    queryKey: ["admin-status"],
    queryFn: fetchSystemStatus,
  });

  const updatedAt =
    status && dataUpdatedAt > 0 ? timeFormatter.format(new Date(dataUpdatedAt)) : null;

  return (
    <div className="flex min-w-0 flex-col gap-6" aria-busy={isFetching}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-extrabold tracking-[-0.03em]">
            Systemstatus
          </h2>
          <p className="mt-1 text-sm text-muted">
            Betriebszustand, Kapazität und Konfiguration auf einen Blick.
          </p>
        </div>

        <div className="flex items-center gap-4 max-sm:w-full max-sm:justify-between">
          <p aria-live="polite" className="min-w-0 sm:text-right">
            <span className="label-mono block">{isFetching ? "Status" : "Zuletzt geprüft"}</span>
            <strong className="mt-0.5 block font-mono text-xs font-medium tabular-nums text-foreground">
              {isFetching ? "Wird aktualisiert…" : (updatedAt ?? "Noch keine Messung")}
            </strong>
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="action-secondary min-h-10 px-3.5 text-xs"
          >
            <RefreshIcon className={`h-4 w-4 ${isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />
            Neu prüfen
          </button>
        </div>
      </header>

      {isLoading && <StatusSkeleton />}

      {error && (
        <div role="alert" className="error-panel flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-danger">
              <span aria-hidden="true" className="inline-block h-2 w-2 rotate-45 rounded-[1px] bg-danger" />
              {status ? "Messung veraltet" : "Keine Messung"}
            </p>
            <strong className="mt-2 block text-base font-semibold text-foreground">
              {status
                ? "Der Status konnte nicht aktualisiert werden."
                : "Der Status konnte nicht geladen werden."}
            </strong>
            <p className="mt-1 [overflow-wrap:anywhere]">{error.message}</p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="action-secondary"
          >
            {isFetching ? "Wird geprüft…" : "Erneut prüfen"}
          </button>
        </div>
      )}

      {status && <StatusBody status={status} />}
    </div>
  );
}
