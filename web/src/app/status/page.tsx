"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import EmptyState from "@/components/ui/EmptyState";
import type { SystemStatus } from "@/types";
import { BackIcon, KeyIcon, RefreshIcon } from "./icons";
import { fetchSystemStatus } from "./statusModel";
import { StatusBody } from "./StatusOverview";

const timeFormatter = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function StatusSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-10">
      <div>
        <p className="label-mono">{label}…</p>
        <span className="skeleton mt-4 block h-12 w-full max-w-xl rounded-[var(--radius-card)] sm:h-14" />
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

export default function StatusPage() {
  const auth = useQuery({
    queryKey: ["status-auth"],
    queryFn: api.me,
    retry: false,
    staleTime: 60_000,
  });
  const me = auth.data;
  const { data: status, dataUpdatedAt, isLoading, isFetching, error, refetch } = useQuery<SystemStatus>({
    queryKey: ["admin-status"],
    queryFn: fetchSystemStatus,
    enabled: !!me?.is_admin,
  });

  if (auth.isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl min-w-0">
        <StatusSkeleton label="Berechtigung wird geprüft" />
      </div>
    );
  }

  if (auth.error) {
    return (
      <section role="alert" className="mx-auto w-full max-w-5xl min-w-0">
        <p className="flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-danger">
          <span aria-hidden="true" className="inline-block h-2 w-2 rotate-45 rounded-[1px] bg-danger" />
          Fehler
        </p>
        <h1 className="mt-3 text-[clamp(1.75rem,4.6vw,3rem)] font-extrabold leading-none tracking-[-0.04em] [overflow-wrap:anywhere]">Berechtigung konnte nicht geprüft werden</h1>
        <p className="error-panel mt-5 max-w-2xl [overflow-wrap:anywhere]">{auth.error.message}</p>
        <button type="button" onClick={() => void auth.refetch()} disabled={auth.isFetching} className="action-secondary mt-5">
          {auth.isFetching ? "Wird erneut geprüft…" : "Erneut prüfen"}
        </button>
      </section>
    );
  }

  if (!me?.is_admin) {
    return (
      <EmptyState
        className="mx-auto max-w-xl"
        icon={<KeyIcon />}
        title="Nur für Administratoren"
        action={
          <Link href="/" className="action-primary">
            Zur Startseite
          </Link>
        }
      />
    );
  }

  const updatedAt = status && dataUpdatedAt > 0 ? timeFormatter.format(new Date(dataUpdatedAt)) : null;

  return (
    <div className="mx-auto w-full max-w-5xl min-w-0" aria-busy={isFetching}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/account?tab=admin" className="label-mono inline-flex min-h-11 items-center gap-1.5 transition-colors hover:text-foreground motion-reduce:transition-none">
          <BackIcon className="h-3.5 w-3.5" /> Verwaltung
        </Link>
        <Link href="/admin/usage" className="section-link inline-flex min-h-11 items-center">
          Nutzungs-Dashboard
        </Link>
      </div>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Systemstatus</h1>
        </div>
        <div className="flex items-center gap-5 max-sm:w-full max-sm:justify-between">
          <p aria-live="polite" className="min-w-0 sm:text-right">
            <span className="label-mono block">{isFetching ? "Status" : "Zuletzt geprüft"}</span>
            <strong className="mt-1 block font-mono text-sm font-medium tabular-nums text-foreground">{isFetching ? "Wird aktualisiert…" : (updatedAt ?? "Noch keine Messung")}</strong>
          </p>
          <button type="button" onClick={() => void refetch()} disabled={isFetching} className="action-secondary">
            <RefreshIcon className={`h-4 w-4 ${isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />
            Neu prüfen
          </button>
        </div>
      </header>

      {isLoading && <StatusSkeleton label="Systemstatus wird geladen" />}

      {error && (
        <div role="alert" className="error-panel mb-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-danger">
              <span aria-hidden="true" className="inline-block h-2 w-2 rotate-45 rounded-[1px] bg-danger" />
              {status ? "Messung veraltet" : "Keine Messung"}
            </p>
            <strong className="mt-2 block text-base font-semibold text-foreground">{status ? "Der Status konnte nicht aktualisiert werden." : "Der Status konnte nicht geladen werden."}</strong>
            <p className="mt-1 [overflow-wrap:anywhere]">{error.message}</p>
          </div>
          <button type="button" onClick={() => void refetch()} disabled={isFetching} className="action-secondary">
            {isFetching ? "Wird geprüft…" : "Erneut prüfen"}
          </button>
        </div>
      )}

      {status && <StatusBody status={status} />}
    </div>
  );
}
