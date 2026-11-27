"use client";

import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  decodeWrappedReport,
  WRAPPED_TEMPLATES,
  WRAPPED_THEMES,
  type WrappedCardOptions,
  type WrappedCardTemplateId,
  type WrappedReport,
  type WrappedTemplateMeta,
  type WrappedThemeId,
  type WrappedThemeMeta,
} from "@/lib/wrapped";
import type { StatsInsightsRange } from "@/types";

export type WrappedTemplateDescriptor = WrappedTemplateMeta;
export type WrappedThemeDescriptor = WrappedThemeMeta;

export const WRAPPED_WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

/** Chapter-to-template mapping so every Story slide jumps into its matching Studio card. */
export const WRAPPED_CHAPTER_TEMPLATES: readonly WrappedCardTemplateId[] = [
  "summary",
  "obsession",
  "festival",
  "aura",
  "peak",
  "persona",
  "receipt",
];

export const DEFAULT_WRAPPED_CARD_OPTIONS: WrappedCardOptions = {
  template: "summary",
  theme: "signal",
  format: "story",
  showUser: true,
  showCounts: true,
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(listener: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

const reducedMotionSnapshot = () => window.matchMedia(REDUCED_MOTION_QUERY).matches;
const serverReducedMotionSnapshot = () => false;

/** Subscribes to the user's `prefers-reduced-motion` OS/browser setting safely. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    serverReducedMotionSnapshot,
  );
}

/** Fetches and strictly decodes the personalized Wrapped report for `range`. */
export function useWrappedReport(range: StatsInsightsRange, enabled = true) {
  return useQuery<WrappedReport>({
    queryKey: ["stats-wrapped", range],
    queryFn: async () => decodeWrappedReport(await api.statsWrapped(range)),
    staleTime: 60_000,
    enabled,
  });
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function getWrappedTemplatesList(): readonly WrappedTemplateMeta[] {
  return WRAPPED_TEMPLATES;
}

export function getWrappedThemesList(): readonly WrappedThemeMeta[] {
  return WRAPPED_THEMES;
}

export function findWrappedTheme(id: WrappedThemeId): WrappedThemeMeta | undefined {
  return WRAPPED_THEMES.find((item) => item.id === id);
}

export function findWrappedTemplate(
  id: WrappedCardTemplateId,
): WrappedTemplateMeta | undefined {
  return WRAPPED_TEMPLATES.find((item) => item.id === id);
}

export function formatPeakDayDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function formatClockHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00 Uhr`;
}

export function ShareNodesIcon({ width = 18, height = 18, className = "" }: { width?: number; height?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}

export function CardsStackIcon({ width = 18, height = 18, className = "" }: { width?: number; height?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="7" y="4" width="12" height="16" rx="2" />
      <path d="M4 8v10a2 2 0 002 2h8" />
    </svg>
  );
}

export function ExternalPageIcon({ width = 16, height = 16, className = "" }: { width?: number; height?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M14 4h6v6" />
      <path d="M10 14L20 4" />
      <path d="M20 14v5a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h5" />
    </svg>
  );
}

type EmblemKind = NonNullable<WrappedReport["persona"]>["emblem"];
type EquivalentKind = WrappedReport["equivalents"][number]["icon"];

/** Distinct crisp vector emblem for all 8 Wrapped persona archetypes. */
export function WrappedEmblemGraphic({
  emblem,
  className = "",
}: {
  emblem: EmblemKind;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 80 80"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {emblem === "moon_wave" && (
        <>
          <path d="M52 22a20 20 0 100 36 16 16 0 110-36z" fill="currentColor" fillOpacity={0.18} />
          <path d="M12 52c8-8 14 8 22 0s14 8 22 0 10-4 12 0" />
        </>
      )}
      {emblem === "infinite_vinyl" && (
        <>
          <circle cx="40" cy="40" r="28" fill="currentColor" fillOpacity={0.12} />
          <circle cx="40" cy="40" r="19" strokeDasharray="6 4" />
          <circle cx="40" cy="40" r="9" />
          <circle cx="40" cy="40" r="3" fill="currentColor" stroke="none" />
        </>
      )}
      {emblem === "compass_radar" && (
        <>
          <circle cx="40" cy="40" r="28" />
          <circle cx="40" cy="40" r="16" strokeOpacity={0.5} />
          <path d="M52 28l-8 16-16 8 8-16z" fill="currentColor" fillOpacity={0.25} />
          <circle cx="40" cy="40" r="3" fill="currentColor" stroke="none" />
        </>
      )}
      {emblem === "tonearm_disc" && (
        <>
          <circle cx="36" cy="42" r="24" fill="currentColor" fillOpacity={0.12} />
          <circle cx="36" cy="42" r="7" />
          <path d="M62 18v24l-14 10" strokeWidth={3} />
          <circle cx="62" cy="18" r="4" fill="currentColor" />
        </>
      )}
      {emblem === "strobe_bars" && (
        <>
          <rect x="14" y="34" width="8" height="28" rx="2" fill="currentColor" fillOpacity={0.25} />
          <rect x="28" y="20" width="8" height="42" rx="2" fill="currentColor" fillOpacity={0.45} />
          <rect x="42" y="14" width="8" height="48" rx="2" fill="currentColor" fillOpacity={0.75} />
          <rect x="56" y="26" width="8" height="36" rx="2" fill="currentColor" fillOpacity={0.35} />
        </>
      )}
      {emblem === "sunrise_pulse" && (
        <>
          <path d="M12 52h56" />
          <path d="M22 52a18 18 0 0136 0" fill="currentColor" fillOpacity={0.2} />
          <path d="M40 14v10M21 23l6 6M59 23l-6 6M12 40h8M60 40h8" />
        </>
      )}
      {emblem === "flame_metro" && (
        <>
          <path
            d="M42 12c4 12 16 18 16 32a18 18 0 11-36 0c0-10 6-17 12-23 1 6 5 9 8 11-2-7 0-14 0-20z"
            fill="currentColor"
            fillOpacity={0.22}
          />
          <path d="M32 52h16" />
        </>
      )}
      {emblem === "prism_beat" && (
        <>
          <polygon points="40,14 66,60 14,60" fill="currentColor" fillOpacity={0.15} />
          <path d="M10 38h20M48 34l20-6M50 42l20 2M47 48l18 10" />
        </>
      )}
    </svg>
  );
}

/** Crisp icon for Wrapped fun equivalents (`vinyl`, `movie`, `flight`, `marathon`, `concert`). */
export function EquivalentGlyph({
  icon,
  className = "",
}: {
  icon: EquivalentKind;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {icon === "vinyl" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
      {icon === "movie" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 5v14M17 5v14M3 9.5h4M17 9.5h4M3 14.5h4M17 14.5h4" />
        </>
      )}
      {icon === "flight" && (
        <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
      )}
      {icon === "marathon" && (
        <>
          <circle cx="14" cy="5" r="2" />
          <path d="M9 21l2-6 4 2 2 4M7 11l4-2 3 2 4-1" />
        </>
      )}
      {icon === "concert" && (
        <>
          <path d="M9 18V5l10-2v13" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="16.5" cy="16" r="2.5" />
        </>
      )}
    </svg>
  );
}
