"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  MusicNoteIcon,
  PauseIcon,
  PlayIcon,
  SpinnerIcon,
} from "@/components/icons";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { formatListeningHours, INSIGHTS_RANGES } from "@/lib/statsInsights";
import type { WrappedCardTemplateId, WrappedReport } from "@/lib/wrapped";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import {
  CardsStackIcon,
  EquivalentGlyph,
  errorMessage,
  formatClockHour,
  formatPeakDayDate,
  ShareNodesIcon,
  usePrefersReducedMotion,
  WRAPPED_CHAPTER_TEMPLATES,
  WRAPPED_WEEKDAYS,
  WrappedEmblemGraphic,
} from "./WrappedExperience";

const CHAPTER_COUNT = 7;
const CHAPTER_DURATION_MS = 7_000;
const NUMERIC_ID_RE = /^\d+$/;
const numberFormatter = new Intl.NumberFormat("de-DE");

const CHAPTER_TITLES = [
  "Deine Hörzeit",
  "Dein #1 Ohrwurm",
  "Festival-Lineup",
  "Klang-Aura & Rhythmus",
  "Rekord-Tag & Serie",
  "Klang-Persönlichkeit",
  "Share-Card Finale",
] as const;

export interface WrappedStoryModalProps {
  open: boolean;
  onClose: () => void;
  report: WrappedReport | undefined;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  onShareTemplate: (template: WrappedCardTemplateId) => void;
}

function ChapterBackdrop({ chapter, report }: { chapter: number; report: WrappedReport }) {
  const auraColors = report.aura?.colors ?? ["#d6ff4b", "#5945a0", "#1fb8c4"];
  const gradients = [
    "radial-gradient(60rem 36rem at 15% 10%, rgba(214, 255, 75, 0.24), transparent 65%), radial-gradient(45rem 30rem at 85% 90%, rgba(124, 92, 255, 0.22), transparent 65%)",
    "radial-gradient(55rem 34rem at 75% 20%, rgba(240, 132, 207, 0.24), transparent 65%), radial-gradient(45rem 30rem at 15% 85%, rgba(214, 255, 75, 0.16), transparent 65%)",
    "radial-gradient(58rem 36rem at 50% 0%, rgba(255, 140, 66, 0.24), transparent 65%), radial-gradient(45rem 30rem at 15% 85%, rgba(214, 255, 75, 0.16), transparent 65%)",
    `radial-gradient(48rem 32rem at 20% 25%, ${auraColors[0]}3d, transparent 65%), radial-gradient(44rem 32rem at 82% 30%, ${auraColors[1]}3d, transparent 65%), radial-gradient(50rem 34rem at 50% 90%, ${auraColors[2]}38, transparent 68%)`,
    "radial-gradient(55rem 36rem at 20% 20%, rgba(58, 160, 255, 0.24), transparent 65%), radial-gradient(45rem 30rem at 80% 85%, rgba(111, 224, 168, 0.2), transparent 65%)",
    "radial-gradient(55rem 34rem at 50% 18%, rgba(214, 255, 75, 0.28), transparent 62%), radial-gradient(50rem 32rem at 20% 85%, rgba(157, 123, 255, 0.24), transparent 65%)",
    "radial-gradient(55rem 34rem at 80% 15%, rgba(214, 255, 75, 0.22), transparent 65%), radial-gradient(50rem 32rem at 15% 80%, rgba(31, 184, 196, 0.2), transparent 65%)",
  ];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none"
      style={{ backgroundImage: gradients[chapter] ?? gradients[0] }}
    />
  );
}

function WrappedStoryDialog({
  onClose,
  report,
  isLoading,
  error,
  onRetry,
  onShareTemplate,
}: Omit<WrappedStoryModalProps, "open">) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const prefersReducedMotion = usePrefersReducedMotion();
  const playTrack = usePlayerStore((s) => s.playTrack);

  useDialogFocus(true, dialogRef, onClose);

  const [chapter, setChapter] = useState(0);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [playingTrack, setPlayingTrack] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const remainingRef = useRef(CHAPTER_DURATION_MS);

  const hasPlays = Boolean(report && report.totals.play_count > 0);
  const effectivePaused =
    !hasPlays || prefersReducedMotion || paused || holding || chapter >= CHAPTER_COUNT - 1;

  function selectChapter(next: number) {
    const clamped = Math.max(0, Math.min(CHAPTER_COUNT - 1, next));
    remainingRef.current = CHAPTER_DURATION_MS;
    setPlayError(null);
    setChapter(clamped);
  }

  function goNext() {
    if (chapter < CHAPTER_COUNT - 1) selectChapter(chapter + 1);
  }

  function goPrev() {
    if (chapter > 0) selectChapter(chapter - 1);
  }

  useEffect(() => {
    if (effectivePaused) return;
    const start = performance.now();
    const timer = window.setTimeout(() => {
      remainingRef.current = CHAPTER_DURATION_MS;
      setPlayError(null);
      setChapter((curr) => (curr < CHAPTER_COUNT - 1 ? curr + 1 : curr));
    }, remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(
        60,
        remainingRef.current - (performance.now() - start),
      );
    };
  }, [chapter, effectivePaused]);

  const onKeyNavigate = useEffectEvent((delta: -1 | 1) => {
    if (!hasPlays) return;
    selectChapter(chapter + delta);
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onKeyNavigate(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onKeyNavigate(-1);
      } else if (event.key === " ") {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "BUTTON" ||
            target.tagName === "A" ||
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT")
        ) {
          return;
        }
        event.preventDefault();
        onKeyNavigate(1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function handlePlayObsession(trackKey: string) {
    if (playingTrack) return;
    if (!NUMERIC_ID_RE.test(trackKey)) {
      const msg = `Dieser Titel hat keine gültige numerische Deezer-ID (${trackKey}) und kann nicht direkt gestartet werden.`;
      setPlayError(msg);
      toast.error(msg);
      return;
    }
    setPlayingTrack(true);
    setPlayError(null);
    try {
      const track = await api.track(trackKey);
      playTrack(track);
      toast.success(`„${track.title}“ wird abgespielt.`);
    } catch (cause) {
      const msg = `Ohrwurm konnte nicht abgespielt werden: ${errorMessage(cause)}`;
      setPlayError(msg);
      toast.error(msg);
    } finally {
      setPlayingTrack(false);
    }
  }

  const rangeLabel = report
    ? INSIGHTS_RANGES.find((r) => r.key === report.range)?.label ?? report.range
    : "";
  const activeTemplate = WRAPPED_CHAPTER_TEMPLATES[chapter] ?? "summary";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[120] flex flex-col bg-[#08080b] text-foreground outline-none"
    >
      <style>{`
        @keyframes wrappedStoryProgress {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
      `}</style>

      {report && <ChapterBackdrop chapter={chapter} report={report} />}

      {/* Top progress bar & controls */}
      <header className="relative z-20 mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        {hasPlays && (
          <div
            role="tablist"
            aria-label="Wrapped-Kapitel"
            className="grid grid-cols-7 gap-1.5"
          >
            {CHAPTER_TITLES.map((label, idx) => {
              const isPast = idx < chapter;
              const isActive = idx === chapter;
              return (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`Kapitel ${idx + 1}: ${label}`}
                  onClick={() => selectChapter(idx)}
                  className="group py-1 text-left"
                >
                  <span className="block h-1.5 w-full overflow-hidden rounded-full bg-white/20 transition-colors group-hover:bg-white/30">
                    {isPast && <span className="block h-full w-full bg-accent" />}
                    {isActive && (
                      <span
                        key={`${chapter}-${prefersReducedMotion ? "static" : "live"}`}
                        className="block h-full w-full origin-left bg-accent"
                        style={
                          prefersReducedMotion || chapter >= CHAPTER_COUNT - 1
                            ? { transform: "scaleX(1)" }
                            : {
                                animation: `wrappedStoryProgress ${CHAPTER_DURATION_MS}ms linear forwards`,
                                animationPlayState: effectivePaused ? "paused" : "running",
                              }
                        }
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="label-mono text-accent">
              LoggeRythm Wrapped{rangeLabel ? ` · ${rangeLabel}` : ""}
            </p>
            <h2 id={titleId} className="truncate text-sm font-semibold text-foreground/90">
              {hasPlays ? `${chapter + 1} / ${CHAPTER_COUNT} · ${CHAPTER_TITLES[chapter]}` : "Dein Rückblick"}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {hasPlays && (
              <button
                type="button"
                aria-pressed={paused}
                onClick={() => setPaused((p) => !p)}
                className="action-secondary min-h-9 gap-1.5 border-white/15 bg-white/5 px-3 text-xs backdrop-blur-sm"
              >
                {paused ? <PlayIcon width={14} height={14} /> : <PauseIcon width={14} height={14} />}
                <span className="hidden sm:inline">{paused ? "Weiter" : "Pause"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Story schließen"
              className="action-icon h-10 min-h-10 w-10 border border-white/15 bg-white/5 text-foreground hover:bg-white/15"
            >
              <CloseIcon width={18} height={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Main story canvas with tap-left / tap-right zones */}
      <main
        className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-4 sm:px-6"
        onPointerDown={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest("button, a, input")) return;
          setHolding(true);
        }}
        onPointerUp={() => setHolding(false)}
        onPointerCancel={() => setHolding(false)}
      >
        {hasPlays && (
          <>
            <button
              type="button"
              aria-label="Vorheriges Kapitel (links tippen)"
              disabled={chapter === 0}
              onClick={goPrev}
              className="absolute inset-y-0 left-0 z-10 w-[22%] cursor-pointer bg-transparent disabled:cursor-default sm:w-[26%]"
            />
            <button
              type="button"
              aria-label="Nächstes Kapitel (rechts tippen)"
              disabled={chapter === CHAPTER_COUNT - 1}
              onClick={goNext}
              className="absolute inset-y-0 right-0 z-10 w-[22%] cursor-pointer bg-transparent disabled:cursor-default sm:w-[26%]"
            />
          </>
        )}

        <div className="relative z-20 mx-auto w-full max-w-3xl">
          {isLoading && !report ? (
            <div role="status" className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <SpinnerIcon width={32} height={32} className="animate-spin text-accent motion-reduce:animate-none" />
              <p className="label-mono text-foreground">Dein Wrapped-Rückblick wird geladen…</p>
            </div>
          ) : error && !report ? (
            <div role="alert" className="error-panel mx-auto flex max-w-lg flex-col items-start gap-3">
              <p className="font-semibold text-foreground">Wrapped konnte nicht geladen werden.</p>
              <p className="text-sm [overflow-wrap:anywhere]">{error.message}</p>
              {onRetry && (
                <button type="button" onClick={onRetry} className="action-secondary min-h-9 px-4 text-xs">
                  Erneut versuchen
                </button>
              )}
            </div>
          ) : !report || report.totals.play_count === 0 ? (
            <EmptyState
              className="mx-auto max-w-lg bg-panel/70"
              icon={<MusicNoteIcon />}
              title={`Noch keine Wiedergaben (${rangeLabel || "Zeitraum"})`}
              action={
                <Link href="/search" onClick={onClose} className="action-primary">
                  Musik entdecken
                </Link>
              }
            >
              Spiel ein paar Titel ab, um deine interaktive Wrapped-Story freizuschalten.
            </EmptyState>
          ) : (
            <div key={chapter} className="animate-in motion-reduce:animate-none">
              {chapter === 0 && <ChapterIntro report={report} rangeLabel={rangeLabel} />}
              {chapter === 1 && (
                <ChapterObsession
                  report={report}
                  playingTrack={playingTrack}
                  playError={playError}
                  onPlay={(key) => void handlePlayObsession(key)}
                />
              )}
              {chapter === 2 && <ChapterFestival report={report} />}
              {chapter === 3 && <ChapterAura report={report} />}
              {chapter === 4 && <ChapterPeakDay report={report} />}
              {chapter === 5 && <ChapterPersona report={report} />}
              {chapter === 6 && (
                <ChapterFinale
                  report={report}
                  rangeLabel={rangeLabel}
                  onOpenStudio={(tpl) => onShareTemplate(tpl)}
                />
              )}
            </div>
          )}
        </div>
      </main>

      {/* Bottom navigation & persistent "Diese Card teilen" CTA */}
      {hasPlays && report && (
        <footer className="relative z-20 mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#08080b]/80 px-4 py-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Vorheriges Kapitel"
              disabled={chapter === 0}
              onClick={goPrev}
              className="action-icon h-10 min-h-10 w-10 border border-white/15 bg-white/5 text-foreground hover:bg-white/15"
            >
              <ChevronLeftIcon width={18} height={18} />
            </button>
            <button
              type="button"
              aria-label="Nächstes Kapitel"
              disabled={chapter === CHAPTER_COUNT - 1}
              onClick={goNext}
              className="action-icon h-10 min-h-10 w-10 border border-white/15 bg-white/5 text-foreground hover:bg-white/15"
            >
              <ChevronRightIcon width={18} height={18} />
            </button>
            <span className="ml-1 hidden font-mono text-xs text-muted sm:inline">
              Tasten: ← / → oder Leertaste
            </span>
          </div>

          <button
            type="button"
            onClick={() => onShareTemplate(activeTemplate)}
            className="action-primary min-h-10 gap-2 bg-accent px-5 text-sm font-bold text-on-accent hover:bg-accent-hover"
          >
            <ShareNodesIcon width={16} height={16} />
            Diese Card teilen
          </button>
        </footer>
      )}
    </div>
  );
}

function ChapterShell({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center rounded-[var(--radius-panel)] border border-white/12 bg-panel/65 p-6 text-center shadow-[0_30px_90px_rgb(0_0_0/0.6)] backdrop-blur-xl sm:p-9">
      <span className="page-eyebrow mb-3 justify-center text-accent">{eyebrow}</span>
      {children}
    </section>
  );
}

function ChapterIntro({
  report,
  rangeLabel,
}: {
  report: WrappedReport;
  rangeLabel: string;
}) {
  const minutes = Math.round(report.totals.listening_sec / 60);
  return (
    <ChapterShell eyebrow={`Kapitel 1 · ${rangeLabel}`}>
      <h3 className="font-display text-4xl font-extrabold leading-[0.95] tracking-[-0.045em] sm:text-6xl">
        {formatListeningHours(report.totals.listening_sec)}
      </h3>
      <p className="mt-3 text-base text-muted sm:text-lg">
        reine Musikzeit in{" "}
        <strong className="text-foreground">
          {numberFormatter.format(report.totals.play_count)}
        </strong>{" "}
        {report.totals.play_count === 1 ? "Wiedergabe" : "Wiedergaben"} ({numberFormatter.format(minutes)} Min.).
      </p>

      <div className="mt-6 grid w-full grid-cols-3 gap-2.5 text-left">
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-3">
          <p className="label-mono text-[10px]">Titel</p>
          <p className="font-display mt-1 text-xl font-extrabold tabular-nums">
            {numberFormatter.format(report.totals.unique_tracks)}
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-3">
          <p className="label-mono text-[10px]">Künstler</p>
          <p className="font-display mt-1 text-xl font-extrabold tabular-nums">
            {numberFormatter.format(report.totals.unique_artists)}
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-3">
          <p className="label-mono text-[10px]">Aktive Tage</p>
          <p className="font-display mt-1 text-xl font-extrabold tabular-nums">
            {report.totals.active_days}/{report.totals.total_days || report.totals.active_days}
          </p>
        </div>
      </div>

      {report.equivalents.length > 0 && (
        <div className="mt-5 grid w-full gap-2.5 sm:grid-cols-3">
          {report.equivalents.slice(0, 3).map((eq, idx) => (
            <div
              key={`${eq.icon}-${idx}`}
              className="flex flex-col items-center gap-1.5 rounded-[var(--radius-card)] border border-accent/25 bg-accent/10 px-3 py-3"
            >
              <EquivalentGlyph icon={eq.icon} className="text-accent" />
              <span className="font-display text-lg font-extrabold leading-tight text-foreground">
                {eq.value}
              </span>
              <span className="text-xs leading-snug text-muted">{eq.label}</span>
            </div>
          ))}
        </div>
      )}
    </ChapterShell>
  );
}

function ChapterObsession({
  report,
  playingTrack,
  playError,
  onPlay,
}: {
  report: WrappedReport;
  playingTrack: boolean;
  playError: string | null;
  onPlay: (trackKey: string) => void;
}) {
  const obs = report.obsession;
  if (!obs) {
    return (
      <ChapterShell eyebrow="Kapitel 2 · Dein #1 Ohrwurm">
        <p className="text-base text-muted">
          Für diesen Zeitraum liegt noch kein eindeutiger Ohrwurm vor.
        </p>
      </ChapterShell>
    );
  }

  const canPlayDirect = NUMERIC_ID_RE.test(obs.track_key);

  return (
    <ChapterShell eyebrow="Kapitel 2 · Auf Dauerschleife">
      <div className="relative mb-5 flex items-center justify-center">
        <div
          aria-hidden="true"
          className="absolute -right-10 h-36 w-36 rounded-full border border-white/15 bg-[radial-gradient(circle,#222_0%,#0c0c10_58%,#1c1b22_60%,#0a0a0d_100%)] shadow-2xl sm:h-44 sm:w-44"
        >
          <span className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-accent bg-panel" />
        </div>
        <Cover
          src={obs.cover}
          alt={obs.title}
          eager
          className="relative z-10 h-40 w-40 rounded-[var(--radius-card)] shadow-[0_24px_60px_rgb(0_0_0/0.7)] ring-1 ring-white/15 sm:h-48 sm:w-48"
        />
      </div>

      <h3 className="font-display max-w-md text-2xl font-extrabold leading-tight tracking-[-0.03em] sm:text-4xl">
        {obs.title}
      </h3>
      <p className="mt-1 text-base font-medium text-muted">
        {obs.artist}
        {obs.album ? ` · ${obs.album}` : ""}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <span className="rounded-full bg-accent px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-on-accent">
          {numberFormatter.format(obs.play_count)}× gespielt
        </span>
        <span className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 font-mono text-xs text-foreground">
          {obs.share_pct}% deiner Hörzeit ({formatListeningHours(obs.listening_sec)})
        </span>
        {obs.peak_day_date && obs.peak_day_plays > 0 && (
          <span className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 font-mono text-xs text-muted">
            Binge-Tag: {formatPeakDayDate(obs.peak_day_date)} ({obs.peak_day_plays}×)
          </span>
        )}
      </div>

      <div className="mt-6 flex flex-col items-center gap-2">
        {canPlayDirect ? (
          <button
            type="button"
            disabled={playingTrack}
            onClick={() => onPlay(obs.track_key)}
            className="action-primary min-h-11 gap-2 px-6 text-sm"
          >
            {playingTrack ? (
              <SpinnerIcon width={16} height={16} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <PlayIcon width={16} height={16} />
            )}
            {playingTrack ? "Wird geladen…" : "Abspielen"}
          </button>
        ) : (
          <p className="font-mono text-xs text-muted">
            Direktwiedergabe für diesen lokalen Verlaufseintrag nicht verfügbar.
          </p>
        )}

        {playError && (
          <p role="alert" className="error-panel mt-2 text-left text-xs [overflow-wrap:anywhere]">
            {playError}
          </p>
        )}
      </div>
    </ChapterShell>
  );
}

function ChapterFestival({ report }: { report: WrappedReport }) {
  const headliner = report.top_artists[0];
  const coHeadliners = report.top_artists.slice(1, 4);
  const undercard = report.top_artists.slice(4, 10);

  return (
    <ChapterShell eyebrow="Kapitel 3 · Dein Festival-Lineup">
      {!headliner ? (
        <p className="text-base text-muted">Noch keine Künstler-Rankings vorhanden.</p>
      ) : (
        <>
          <p className="label-mono text-[10px] tracking-[0.2em] text-muted">HEADLINER</p>
          <div className="mt-3 flex flex-col items-center gap-3">
            <Cover
              src={headliner.cover}
              alt={headliner.label}
              eager
              className="h-28 w-28 rounded-full ring-2 ring-accent ring-offset-4 ring-offset-panel sm:h-32 sm:w-32"
            />
            <h3 className="font-display text-3xl font-extrabold uppercase leading-none tracking-[-0.04em] sm:text-5xl">
              {headliner.label}
            </h3>
            <p className="font-mono text-xs text-accent">
              {numberFormatter.format(headliner.count)}× · {headliner.share_pct}% Anteil
            </p>
          </div>

          {coHeadliners.length > 0 && (
            <div className="mt-6 w-full border-t border-white/10 pt-4">
              <p className="label-mono mb-2 text-[10px]">CO-HEADLINER</p>
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
                {coHeadliners.map((artist, idx) => (
                  <span key={`${artist.key}-${idx}`} className="font-display text-lg font-bold tracking-tight text-foreground sm:text-xl">
                    {idx > 0 && <span className="mr-3 text-accent">★</span>}
                    {artist.label}
                    <span className="ml-1.5 font-mono text-xs font-normal text-muted">
                      ({artist.count}×)
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {undercard.length > 0 && (
            <div className="mt-5 flex flex-wrap justify-center gap-1.5">
              {undercard.map((artist, idx) => (
                <span
                  key={`${artist.key}-${idx}`}
                  className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 font-mono text-[11px] text-muted"
                >
                  #{artist.rank} {artist.label}
                </span>
              ))}
            </div>
          )}

          {report.totals.new_artists_count > 0 && (
            <p className="mt-5 font-mono text-xs text-success">
              +{numberFormatter.format(report.totals.new_artists_count)} neue Künstler in diesem Zeitraum entdeckt
            </p>
          )}
        </>
      )}
    </ChapterShell>
  );
}

function ChapterAura({ report }: { report: WrappedReport }) {
  const maxHour = Math.max(1, ...report.rhythm.hourly_distribution);

  return (
    <ChapterShell eyebrow="Kapitel 4 · Klang-Aura & 24h-Rhythmus">
      {report.aura ? (
        <>
          <div className="mb-3 flex items-center gap-2">
            {report.aura.colors.map((hex, i) => (
              <span
                key={`${hex}-${i}`}
                aria-label={`Aura-Farbe ${hex}`}
                className="h-5 w-5 rounded-full ring-2 ring-white/20"
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
          <h3 className="font-display text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">
            {report.aura.title}
          </h3>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted sm:text-base">
            {report.aura.description}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {report.aura.mood_tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-white/15 bg-white/8 px-3 py-1 font-mono text-xs text-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </>
      ) : (
        <h3 className="font-display text-3xl font-extrabold tracking-[-0.04em]">
          {report.rhythm.chronotype_label}
        </h3>
      )}

      {/* 24h Rhythm Bar Sparkline */}
      <div className="mt-6 w-full rounded-[var(--radius-card)] border border-white/10 bg-black/30 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
          <span className="text-muted">{report.rhythm.chronotype_label}</span>
          <span className="text-accent">Peak: {formatClockHour(report.rhythm.peak_hour)}</span>
        </div>
        <div className="grid h-20 grid-cols-24 items-end gap-1" role="img" aria-label="24-Stunden-Hörverteilung">
          {report.rhythm.hourly_distribution.map((count, hour) => {
            const pct = count === 0 ? 8 : Math.max(16, Math.round((count / maxHour) * 100));
            const isPeak = hour === report.rhythm.peak_hour;
            return (
              <div
                key={hour}
                style={{ height: `${pct}%` }}
                title={`${formatClockHour(hour)} · ${count}×`}
                className={`rounded-t-sm ${isPeak ? "bg-accent" : count > 0 ? "bg-white/45" : "bg-white/10"}`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-2 font-mono text-[11px] text-muted">
          <span>Wochenend-Anteil: {report.rhythm.weekend_share_pct}%</span>
          <span>Entdecker: {report.rhythm.discovery_score_pct}%</span>
          <span>Wiederholung: {report.rhythm.repeat_score_pct}%</span>
        </div>
      </div>

      {report.tempo ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-accent/35 bg-accent/10 px-4 py-1.5 font-mono text-xs text-accent">
          <span>Ø {report.tempo.avg_bpm} BPM</span>
          <span>·</span>
          <span>{report.tempo.vibe_label}</span>
          <span className="text-muted">({report.tempo.min_bpm}–{report.tempo.max_bpm})</span>
        </div>
      ) : (
        <p className="mt-4 font-mono text-[11px] text-subtle">
          Noch keine BPM-Audioanalyse für die gespielten Titel vorhanden.
        </p>
      )}
    </ChapterShell>
  );
}

function ChapterPeakDay({ report }: { report: WrappedReport }) {
  const peak = report.peak_day;
  const maxDay = Math.max(1, ...report.rhythm.weekday_distribution);

  return (
    <ChapterShell eyebrow="Kapitel 5 · Rekord-Tag & Hör-Serie">
      <div className="grid w-full grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-card)] border border-accent/30 bg-accent/10 p-4">
          <p className="label-mono text-[10px] text-accent">Längste Serie</p>
          <p className="font-display mt-1 text-3xl font-extrabold tabular-nums sm:text-4xl">
            {report.totals.longest_streak_days}
            <span className="ml-1.5 text-base font-semibold text-muted">
              {report.totals.longest_streak_days === 1 ? "Tag" : "Tage"}
            </span>
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-white/12 bg-white/[0.04] p-4">
          <p className="label-mono text-[10px]">Aktuelle Serie</p>
          <p className="font-display mt-1 text-3xl font-extrabold tabular-nums sm:text-4xl">
            {report.totals.current_streak_days}
            <span className="ml-1.5 text-base font-semibold text-muted">
              {report.totals.current_streak_days === 1 ? "Tag" : "Tage"}
            </span>
          </p>
        </div>
      </div>

      {peak ? (
        <div className="mt-4 flex w-full flex-col items-center gap-4 rounded-[var(--radius-card)] border border-white/12 bg-black/35 p-4 text-left sm:flex-row">
          <Cover src={peak.top_track_cover} alt={peak.top_track_title} eager className="h-20 w-20 rounded-art" />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="label-mono text-[10px] text-accent">Rekord-Tag · {formatPeakDayDate(peak.date)}</p>
            <p className="font-display mt-1 text-xl font-extrabold">
              {formatListeningHours(peak.listening_sec)} · {numberFormatter.format(peak.play_count)}{" "}
              {peak.play_count === 1 ? "Wiedergabe" : "Wiedergaben"}
            </p>
            <p className="mt-1 truncate text-xs text-muted">
              Meistgespielt an dem Tag: <strong className="text-foreground">{peak.top_track_title}</strong> ({peak.top_track_artist})
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">Kein Rekord-Tag in diesem Zeitraum erfasst.</p>
      )}

      <div className="mt-4 grid w-full grid-cols-7 gap-1.5 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] px-3 py-3">
        {report.rhythm.weekday_distribution.map((count, idx) => {
          const pct = count === 0 ? 10 : Math.round((count / maxDay) * 100);
          return (
            <div key={WRAPPED_WEEKDAYS[idx]} className="flex flex-col items-center gap-1.5">
              <div className="flex h-12 w-full items-end justify-center">
                <div
                  style={{ height: `${pct}%` }}
                  className={`w-full max-w-6 rounded-t ${idx === report.rhythm.peak_weekday ? "bg-accent" : "bg-white/30"}`}
                />
              </div>
              <span className="font-mono text-[10px] text-muted">{WRAPPED_WEEKDAYS[idx]}</span>
            </div>
          );
        })}
      </div>
    </ChapterShell>
  );
}

function ChapterPersona({ report }: { report: WrappedReport }) {
  const persona = report.persona;
  if (!persona) {
    return (
      <ChapterShell eyebrow="Kapitel 6 · Klang-Persönlichkeit">
        <p className="text-base text-muted">
          Noch zu wenige Daten für deine Klang-Persönlichkeit.
        </p>
      </ChapterShell>
    );
  }

  return (
    <ChapterShell eyebrow="Kapitel 6 · Deine Klang-Persönlichkeit">
      <div className="mb-4 grid h-24 w-24 place-items-center rounded-2xl border border-accent/35 bg-accent/12 text-accent shadow-[0_0_50px_rgba(214,255,75,0.2)]">
        <WrappedEmblemGraphic emblem={persona.emblem} className="h-16 w-16" />
      </div>
      <p className="label-mono text-xs text-muted">{persona.subtitle}</p>
      <h3 className="font-display mt-1.5 text-3xl font-extrabold leading-tight tracking-[-0.04em] sm:text-5xl">
        {persona.title}
      </h3>
      <p className="mt-3 max-w-lg text-sm leading-relaxed text-foreground/85 sm:text-base">
        „{persona.tagline}“
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {persona.traits.map((trait) => (
          <span
            key={trait}
            className="rounded-full border border-accent/30 bg-accent/10 px-3.5 py-1.5 font-mono text-xs font-medium text-accent"
          >
            {trait}
          </span>
        ))}
      </div>
    </ChapterShell>
  );
}

function ChapterFinale({
  report,
  rangeLabel,
  onOpenStudio,
}: {
  report: WrappedReport;
  rangeLabel: string;
  onOpenStudio: (template: WrappedCardTemplateId) => void;
}) {
  const quickCards: { id: WrappedCardTemplateId; label: string }[] = [
    { id: "summary", label: "Rückblick" },
    { id: "receipt", label: "Sound-Beleg" },
    { id: "festival", label: "Festival-Poster" },
    { id: "obsession", label: "Ohrwurm-Vinyl" },
  ];

  return (
    <ChapterShell eyebrow={`Kapitel 7 · Finale (${rangeLabel})`}>
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-accent/40 bg-accent/15 text-accent">
        <CardsStackIcon width={30} height={30} />
      </div>
      <h3 className="font-display text-3xl font-extrabold leading-tight tracking-[-0.04em] sm:text-4xl">
        Bereit zum Teilen
      </h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted sm:text-base">
        Gestalte jetzt deine hochauflösenden Share-Cards in 7 Vorlagen, 5 Farbwelten und Story- oder Quadrat-Format.
      </p>

      <div className="mt-5 grid w-full grid-cols-2 gap-2.5 text-left sm:grid-cols-3">
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-3">
          <p className="label-mono text-[10px]">Hörzeit</p>
          <p className="mt-1 truncate font-semibold">{formatListeningHours(report.totals.listening_sec)}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-3">
          <p className="label-mono text-[10px]">#1 Künstler</p>
          <p className="mt-1 truncate font-semibold">{report.top_artists[0]?.label ?? "—"}</p>
        </div>
        <div className="col-span-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-3 sm:col-span-1">
          <p className="label-mono text-[10px]">Persönlichkeit</p>
          <p className="mt-1 truncate font-semibold">{report.persona?.title ?? report.rhythm.chronotype_label}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onOpenStudio("summary")}
        className="action-primary mt-6 min-h-12 gap-2 px-7 text-base"
      >
        <CardsStackIcon width={18} height={18} />
        Card Studio öffnen
      </button>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {quickCards.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenStudio(item.id)}
            className="filter-chip min-h-8 border-white/15 bg-white/5 text-xs text-foreground hover:border-accent/60"
          >
            {item.label}
          </button>
        ))}
      </div>

      {report.top_tracks[0] && (
        <p className="mt-4 font-mono text-[11px] text-muted">
          Top-Track: {report.top_tracks[0].label} · {numberFormatter.format(report.top_tracks[0].count)}×
          {report.top_tracks[0].listening_sec > 0 ? ` (${formatTime(report.top_tracks[0].listening_sec)})` : ""}
        </p>
      )}
    </ChapterShell>
  );
}

export default function WrappedStoryModal({
  open,
  onClose,
  ...rest
}: WrappedStoryModalProps) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<WrappedStoryDialog onClose={onClose} {...rest} />, document.body);
}
