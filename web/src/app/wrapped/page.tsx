"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import EmptyState from "@/components/ui/EmptyState";
import { MusicNoteIcon, PlayIcon, UserIcon } from "@/components/icons";
import WrappedStoryModal from "@/components/wrapped/WrappedStoryModal";
import { WrappedStudioView } from "@/components/wrapped/WrappedStudioModal";
import {
  DEFAULT_WRAPPED_CARD_OPTIONS,
  getWrappedTemplatesList,
  getWrappedThemesList,
  useWrappedReport,
} from "@/components/wrapped/WrappedExperience";
import { useMe } from "@/hooks/useAuth";
import { formatListeningHours, INSIGHTS_RANGES } from "@/lib/statsInsights";
import type {
  WrappedCardOptions,
  WrappedCardTemplateId,
  WrappedFormat,
  WrappedThemeId,
} from "@/lib/wrapped";
import type { StatsInsightsRange } from "@/types";

const numberFormatter = new Intl.NumberFormat("de-DE");

function parseRangeParam(raw: string | null): StatsInsightsRange {
  if (raw && INSIGHTS_RANGES.some((item) => item.key === raw)) {
    return raw as StatsInsightsRange;
  }
  return "30d";
}

function parseTemplateParam(raw: string | null): WrappedCardTemplateId {
  const templates = getWrappedTemplatesList();
  if (raw && templates.some((item) => item.id === raw)) {
    return raw as WrappedCardTemplateId;
  }
  return DEFAULT_WRAPPED_CARD_OPTIONS.template;
}

function parseThemeParam(raw: string | null): WrappedThemeId {
  const themes = getWrappedThemesList();
  if (raw && themes.some((item) => item.id === raw)) {
    return raw as WrappedThemeId;
  }
  return DEFAULT_WRAPPED_CARD_OPTIONS.theme;
}

function parseFormatParam(raw: string | null): WrappedFormat {
  return raw === "square" ? "square" : "story";
}

function WrappedPageSkeleton() {
  return (
    <div role="status" aria-label="Wrapped-Seite wird geladen" className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="skeleton h-3 w-36 rounded" />
        <span className="skeleton h-12 w-64 rounded-lg" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="skeleton mx-auto aspect-[9/16] w-[min(100%,340px)] rounded-[var(--radius-panel)]" />
        <div className="skeleton h-[460px] rounded-[var(--radius-panel)]" />
      </div>
    </div>
  );
}

function WrappedPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: me, isLoading: meLoading, error: meError, refetch: refetchMe, isFetching: meFetching } = useMe();

  const [range, setRange] = useState<StatsInsightsRange>(() =>
    parseRangeParam(searchParams.get("range")),
  );
  const [options, setOptions] = useState<WrappedCardOptions>(() => ({
    ...DEFAULT_WRAPPED_CARD_OPTIONS,
    template: parseTemplateParam(searchParams.get("template")),
    theme: parseThemeParam(searchParams.get("theme")),
    format: parseFormatParam(searchParams.get("format")),
  }));
  const [storyOpen, setStoryOpen] = useState<boolean>(
    () => searchParams.get("mode") === "story",
  );

  const wrappedQuery = useWrappedReport(range, Boolean(me));
  const report = wrappedQuery.data;

  function syncUrl(nextRange: StatsInsightsRange, nextTemplate: WrappedCardTemplateId) {
    const params = new URLSearchParams();
    params.set("range", nextRange);
    params.set("template", nextTemplate);
    router.replace(`/wrapped?${params.toString()}`, { scroll: false });
  }

  function handleRangeChange(nextRange: StatsInsightsRange) {
    setRange(nextRange);
    syncUrl(nextRange, options.template);
  }

  function handleOptionsChange(updater: (prev: WrappedCardOptions) => WrappedCardOptions) {
    setOptions((prev) => {
      const next = updater(prev);
      if (next.template !== prev.template) {
        syncUrl(range, next.template);
      }
      return next;
    });
  }

  if (meLoading) {
    return <WrappedPageSkeleton />;
  }

  if (meError && !me) {
    return (
      <section role="alert" className="error-panel mx-auto flex max-w-xl flex-col items-start gap-3">
        <h1 className="text-xl font-semibold text-foreground">Konto konnte nicht geladen werden</h1>
        <p className="[overflow-wrap:anywhere]">{meError.message}</p>
        <button
          type="button"
          onClick={() => void refetchMe()}
          disabled={meFetching}
          className="action-secondary"
        >
          {meFetching ? "Wird geladen…" : "Erneut versuchen"}
        </button>
      </section>
    );
  }

  if (!me) {
    return (
      <EmptyState
        className="mx-auto max-w-xl"
        icon={<UserIcon />}
        title="Du bist nicht angemeldet"
        action={
          <Link href="/login?next=/wrapped" className="action-primary">
            Anmelden
          </Link>
        }
      >
        Melde dich an, um deine persönliche Wrapped-Story und Share-Cards zu öffnen.
      </EmptyState>
    );
  }

  const periodLabel = INSIGHTS_RANGES.find((r) => r.key === range)?.label ?? range;

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-7">
      <header className="page-header mb-0">
        <div className="min-w-0">
          <p className="page-eyebrow">LoggeRythm Wrapped · {periodLabel}</p>
          <h1 className="page-title">Dein Wrapped</h1>
          <p className="page-description">
            Erlebe deinen Rückblick als interaktive 7-Kapitel-Story oder exportiere hochauflösende Share-Cards für Story und Feed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {report && report.totals.play_count > 0 && (
            <button
              type="button"
              onClick={() => setStoryOpen(true)}
              className="action-primary gap-2 bg-accent text-on-accent hover:bg-accent-hover"
            >
              <PlayIcon width={16} height={16} />
              Wrapped Story starten
            </button>
          )}
          <Link href="/account?tab=stats" className="action-secondary">
            Zurück zum Hörprofil
          </Link>
        </div>
      </header>

      {wrappedQuery.isLoading && !report ? (
        <WrappedPageSkeleton />
      ) : wrappedQuery.error && !report ? (
        <div role="alert" className="error-panel flex flex-col items-start gap-3">
          <p className="font-semibold text-foreground">Dein Wrapped-Bericht konnte nicht geladen werden.</p>
          <p className="text-sm [overflow-wrap:anywhere]">{wrappedQuery.error.message}</p>
          <button
            type="button"
            onClick={() => void wrappedQuery.refetch()}
            disabled={wrappedQuery.isFetching}
            className="action-secondary min-h-9 px-4 text-xs"
          >
            {wrappedQuery.isFetching ? "Wird geladen…" : "Erneut versuchen"}
          </button>
        </div>
      ) : !report || report.totals.play_count === 0 ? (
        <div className="flex flex-col gap-5">
          <div role="group" aria-label="Zeitraum wählen" className="flex flex-wrap items-center gap-1.5">
            {INSIGHTS_RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={range === item.key}
                onClick={() => handleRangeChange(item.key)}
                className="filter-chip min-h-9 px-3.5 text-xs"
              >
                {item.label}
              </button>
            ))}
          </div>
          <EmptyState
            icon={<MusicNoteIcon />}
            title={`Noch keine Wiedergaben (${periodLabel})`}
            action={
              <Link href="/search" className="action-primary">
                Musik entdecken
              </Link>
            }
          >
            Spiel Musik ab oder wähle einen größeren Zeitraum, um deine Wrapped Story und Share-Cards freizuschalten.
          </EmptyState>
        </div>
      ) : (
        <>
          <section
            aria-label="Wrapped Highlights"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            <div className="rounded-[var(--radius-card)] border border-hairline bg-panel/60 p-3.5">
              <p className="label-mono text-[10px]">Hörzeit</p>
              <p className="font-display mt-1 text-xl font-extrabold tabular-nums">
                {formatListeningHours(report.totals.listening_sec)}
              </p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-hairline bg-panel/60 p-3.5">
              <p className="label-mono text-[10px]">Wiedergaben</p>
              <p className="font-display mt-1 text-xl font-extrabold tabular-nums">
                {numberFormatter.format(report.totals.play_count)}
              </p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-hairline bg-panel/60 p-3.5">
              <p className="label-mono text-[10px]">#1 Künstler</p>
              <p className="mt-1 truncate text-sm font-bold">
                {report.top_artists[0]?.label ?? "—"}
              </p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-hairline bg-panel/60 p-3.5">
              <p className="label-mono text-[10px]">Klang-Typ</p>
              <p className="mt-1 truncate text-sm font-bold text-accent">
                {report.persona?.title ?? report.rhythm.chronotype_label}
              </p>
            </div>
          </section>

          <WrappedStudioView
            report={report}
            isLoading={wrappedQuery.isLoading}
            isFetching={wrappedQuery.isFetching}
            error={wrappedQuery.error}
            onRetry={() => void wrappedQuery.refetch()}
            range={range}
            onRangeChange={handleRangeChange}
            options={options}
            onOptionsChange={handleOptionsChange}
            onOpenStory={() => setStoryOpen(true)}
          />
        </>
      )}

      <WrappedStoryModal
        open={storyOpen}
        onClose={() => setStoryOpen(false)}
        report={report}
        isLoading={wrappedQuery.isLoading}
        error={wrappedQuery.error}
        onRetry={() => void wrappedQuery.refetch()}
        onShareTemplate={(tpl) => {
          setStoryOpen(false);
          handleOptionsChange((prev) => ({ ...prev, template: tpl }));
        }}
      />
    </div>
  );
}

export default function WrappedPage() {
  return (
    <Suspense fallback={<WrappedPageSkeleton />}>
      <WrappedPageContent />
    </Suspense>
  );
}
