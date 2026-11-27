"use client";

import Link from "next/link";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import EmptyState from "@/components/ui/EmptyState";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  MusicNoteIcon,
  PlayIcon,
  SpinnerIcon,
} from "@/components/icons";
import { CheckCircleIcon, CopyIcon } from "@/components/feedbackIcons";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { INSIGHTS_RANGES } from "@/lib/statsInsights";
import {
  canWebShareFiles,
  copyPngBlobToClipboard,
  downloadBlob,
  formatWrappedSummaryText,
  sharePngBlob,
  type WrappedCardOptions,
  type WrappedFormat,
  type WrappedReport,
} from "@/lib/wrapped";
import { getWrappedCanvasDimensions } from "@/lib/wrappedCanvas";
import { toast } from "@/store/toast";
import type { StatsInsightsRange } from "@/types";
import WrappedCardPreview, { type WrappedCardPreviewHandle } from "./WrappedCardPreview";
import {
  errorMessage,
  ExternalPageIcon,
  findWrappedTemplate,
  getWrappedTemplatesList,
  getWrappedThemesList,
  ShareNodesIcon,
} from "./WrappedExperience";

const emptySubscribe = () => () => {};
const webShareFilesSnapshot = () => canWebShareFiles();
const serverWebShareFilesSnapshot = () => false;

function useCanWebShareFiles(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    webShareFilesSnapshot,
    serverWebShareFilesSnapshot,
  );
}

export interface WrappedStudioViewProps {
  report: WrappedReport | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  onRetry: () => void;
  range: StatsInsightsRange;
  onRangeChange: (next: StatsInsightsRange) => void;
  options: WrappedCardOptions;
  onOptionsChange: (updater: (prev: WrappedCardOptions) => WrappedCardOptions) => void;
  onOpenStory?: () => void;
  inModal?: boolean;
  onCloseModal?: () => void;
}

type ExportAction = "download" | "copy-image" | "share-image" | "copy-text" | null;

export function WrappedStudioView({
  report,
  isLoading,
  isFetching,
  error,
  onRetry,
  range,
  onRangeChange,
  options,
  onOptionsChange,
  onOpenStory,
  inModal = false,
  onCloseModal,
}: WrappedStudioViewProps) {
  const previewRef = useRef<WrappedCardPreviewHandle>(null);
  const [busyAction, setBusyAction] = useState<ExportAction>(null);
  const [copiedImage, setCopiedImage] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const supportsFileShare = useCanWebShareFiles();
  const templates = getWrappedTemplatesList();
  const themes = getWrappedThemesList();
  const activeTemplateIndex = Math.max(
    0,
    templates.findIndex((item) => item.id === options.template),
  );
  const activeTemplateMeta = findWrappedTemplate(options.template);
  const dimensions = getWrappedCanvasDimensions(options.format);
  const rangeLabel = INSIGHTS_RANGES.find((r) => r.key === range)?.label ?? range;

  function cycleTemplate(delta: -1 | 1) {
    if (templates.length === 0) return;
    const nextIdx = (activeTemplateIndex + delta + templates.length) % templates.length;
    const nextTemplate = templates[nextIdx]?.id;
    if (!nextTemplate) return;
    setActionError(null);
    onOptionsChange((prev) => ({ ...prev, template: nextTemplate }));
  }

  async function requirePngBlob(): Promise<Blob> {
    if (!previewRef.current) {
      throw new Error("Die Karten-Vorschau ist nicht bereit.");
    }
    return await previewRef.current.exportPngBlob();
  }

  async function handleDownloadPng() {
    if (!report || busyAction !== null) return;
    setBusyAction("download");
    setActionError(null);
    try {
      const blob = await requirePngBlob();
      const filename = `loggerhythm-wrapped-${report.range}-${options.template}-${options.format}.png`;
      downloadBlob(blob, filename);
      toast.success("PNG-Card heruntergeladen.");
    } catch (cause) {
      const msg = `PNG-Export fehlgeschlagen: ${errorMessage(cause)}`;
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopyImage() {
    if (!report || busyAction !== null) return;
    setBusyAction("copy-image");
    setActionError(null);
    try {
      const blob = await requirePngBlob();
      await copyPngBlobToClipboard(blob);
      setCopiedImage(true);
      toast.success("Share-Card als Bild in die Zwischenablage kopiert.");
      window.setTimeout(() => setCopiedImage(false), 2500);
    } catch (cause) {
      const msg = `Bild konnte nicht kopiert werden: ${errorMessage(cause)}`;
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleShareImage() {
    if (!report || busyAction !== null) return;
    if (!supportsFileShare) {
      const msg =
        "Dieser Browser unterstützt kein direktes Bild-Teilen über die Web Share API. Lade das PNG herunter oder nutze „Bild kopieren“.";
      setActionError(msg);
      toast.error(msg);
      return;
    }
    setBusyAction("share-image");
    setActionError(null);
    try {
      const blob = await requirePngBlob();
      const title = `LoggeRythm Wrapped (${rangeLabel})`;
      const text = formatWrappedSummaryText(report);
      const result = await sharePngBlob(blob, title, text);
      if (result.cancelled) {
        toast.info("Teilen abgebrochen.");
      } else if (result.shared) {
        toast.success("Share-Card geteilt.");
      } else {
        throw new Error("Teilen wurde vom Browser nicht abgeschlossen.");
      }
    } catch (cause) {
      const msg = `Teilen fehlgeschlagen: ${errorMessage(cause)}`;
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopyText() {
    if (!report || busyAction !== null) return;
    setBusyAction("copy-text");
    setActionError(null);
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Die Zwischenablage-API ist in diesem Browser nicht verfügbar.");
      }
      await navigator.clipboard.writeText(formatWrappedSummaryText(report));
      setCopiedText(true);
      toast.success("Wrapped-Zusammenfassung als Text kopiert.");
      window.setTimeout(() => setCopiedText(false), 2500);
    } catch (cause) {
      const msg = `Text konnte nicht kopiert werden: ${errorMessage(cause)}`;
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  }

  if (isLoading && !report) {
    return (
      <div role="status" aria-label="Card Studio wird geladen" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="skeleton mx-auto aspect-[9/16] w-[min(100%,340px)] rounded-[var(--radius-panel)]" />
        <div className="flex flex-col gap-4">
          <div className="skeleton h-20 rounded-[var(--radius-card)]" />
          <div className="skeleton h-32 rounded-[var(--radius-card)]" />
          <div className="skeleton h-28 rounded-[var(--radius-card)]" />
          <div className="skeleton h-24 rounded-[var(--radius-card)]" />
        </div>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div role="alert" className="error-panel flex flex-col items-start gap-3">
        <p className="font-semibold text-foreground">Dein Wrapped-Bericht konnte nicht geladen werden.</p>
        <p className="text-sm [overflow-wrap:anywhere]">{error.message}</p>
        <button
          type="button"
          onClick={onRetry}
          disabled={isFetching}
          className="action-secondary min-h-9 px-4 text-xs"
        >
          {isFetching ? "Wird geladen…" : "Erneut versuchen"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && report && (
        <div role="alert" className="error-panel flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 [overflow-wrap:anywhere]">
            Aktualisierung fehlgeschlagen: {error.message}
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={isFetching}
            className="action-secondary min-h-9 px-4 text-xs"
          >
            Erneut versuchen
          </button>
        </div>
      )}

      {!report || report.totals.play_count === 0 ? (
        <div className="flex flex-col gap-5">
          <div role="group" aria-label="Zeitraum wählen" className="flex flex-wrap items-center gap-1.5">
            {INSIGHTS_RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={range === item.key}
                onClick={() => onRangeChange(item.key)}
                className="filter-chip min-h-9 px-3.5 text-xs"
              >
                {item.label}
              </button>
            ))}
          </div>
          <EmptyState
            icon={<MusicNoteIcon />}
            title={`Noch keine Wiedergaben (${rangeLabel})`}
            action={
              <Link href="/search" onClick={onCloseModal} className="action-primary">
                Musik entdecken
              </Link>
            }
          >
            Wähle oben einen größeren Zeitraum oder hör ein paar Titel an, um Share-Cards zu erstellen.
          </EmptyState>
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
          {/* Left / Center Stage */}
          <section
            aria-label="Share-Card Bühne"
            className="flex min-w-0 flex-col items-center gap-4 rounded-[var(--radius-panel)] border border-hairline bg-background/70 p-4 sm:p-6"
          >
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-hairline bg-panel px-3 py-1 font-mono text-[11px] text-foreground">
                  {dimensions.width}×{dimensions.height} px
                </span>
                {activeTemplateMeta && (
                  <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-[11px] text-accent">
                    {activeTemplateMeta.badge || activeTemplateMeta.label}
                  </span>
                )}
              </div>

              {inModal && (
                <Link
                  href={`/wrapped?range=${encodeURIComponent(range)}&template=${encodeURIComponent(options.template)}`}
                  onClick={onCloseModal}
                  className="inline-flex items-center gap-1.5 font-mono text-xs text-muted transition-colors hover:text-accent"
                >
                  <ExternalPageIcon width={14} height={14} />
                  <span>/wrapped öffnen</span>
                </Link>
              )}
            </div>

            <WrappedCardPreview
              ref={previewRef}
              report={report}
              options={options}
              enableTilt
              className="w-full py-1"
            />

            <div className="flex w-full max-w-sm items-center justify-between gap-2 pt-1">
              <button
                type="button"
                aria-label="Vorherige Vorlage"
                onClick={() => cycleTemplate(-1)}
                className="action-secondary min-h-9 gap-1 px-3 text-xs"
              >
                <ChevronLeftIcon width={15} height={15} />
                Zurück
              </button>
              <span className="truncate font-mono text-xs text-muted">
                {activeTemplateIndex + 1} / {templates.length} ·{" "}
                <strong className="text-foreground">
                  {activeTemplateMeta?.shortLabel ?? options.template}
                </strong>
              </span>
              <button
                type="button"
                aria-label="Nächste Vorlage"
                onClick={() => cycleTemplate(1)}
                className="action-secondary min-h-9 gap-1 px-3 text-xs"
              >
                Weiter
                <ChevronRightIcon width={15} height={15} />
              </button>
            </div>
          </section>

          {/* Right Controls Dock */}
          <aside aria-label="Card-Einstellungen" className="flex min-w-0 flex-col gap-5 rounded-[var(--radius-panel)] border border-hairline bg-panel/60 p-4 sm:p-5">
            {/* 1. Zeitraum */}
            <div>
              <p className="label-mono mb-2">Zeitraum</p>
              <div role="group" aria-label="Zeitraum wählen" className="flex flex-wrap gap-1.5">
                {INSIGHTS_RANGES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={range === item.key}
                    onClick={() => {
                      setActionError(null);
                      onRangeChange(item.key);
                    }}
                    className="filter-chip min-h-8 px-3 text-xs"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Vorlage (7 templates) */}
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="label-mono">Vorlage</p>
                {activeTemplateMeta?.description && (
                  <span className="truncate text-[11px] text-muted">
                    {activeTemplateMeta.description}
                  </span>
                )}
              </div>
              <div role="group" aria-label="Card-Vorlage wählen" className="flex flex-wrap gap-1.5">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    aria-pressed={options.template === tpl.id}
                    onClick={() => {
                      setActionError(null);
                      onOptionsChange((prev) => ({ ...prev, template: tpl.id }));
                    }}
                    className="filter-chip min-h-8 px-3 text-xs"
                  >
                    {tpl.shortLabel || tpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Theme Swatches (5 themes) */}
            <div>
              <p className="label-mono mb-2">Farbwelt</p>
              <div role="group" aria-label="Farbwelt wählen" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
                {themes.map((theme) => {
                  const active = options.theme === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setActionError(null);
                        onOptionsChange((prev) => ({ ...prev, theme: theme.id }));
                      }}
                      className={`flex min-h-10 items-center gap-2.5 rounded-[var(--radius-control)] border px-2.5 py-1.5 text-left text-xs font-semibold transition-colors ${
                        active
                          ? "border-accent bg-accent/12 text-foreground"
                          : "border-border bg-background/40 text-muted hover:border-foreground/30 hover:text-foreground"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full border border-white/25"
                        style={{ backgroundColor: theme.palette.bg }}
                      >
                        <span
                          className="absolute inset-y-0 right-0 w-1/2"
                          style={{ backgroundColor: theme.palette.accent }}
                        />
                      </span>
                      <span className="truncate">{theme.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Format Toggle + Toggles */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div>
                <p className="label-mono mb-2">Format</p>
                <div role="group" aria-label="Bildformat wählen" className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: "story", label: "Story 9:16" },
                      { id: "square", label: "Quadrat 1:1" },
                    ] as const satisfies readonly { id: WrappedFormat; label: string }[]
                  ).map((fmt) => (
                    <button
                      key={fmt.id}
                      type="button"
                      aria-pressed={options.format === fmt.id}
                      onClick={() => {
                        setActionError(null);
                        onOptionsChange((prev) => ({ ...prev, format: fmt.id }));
                      }}
                      className="filter-chip min-h-9 justify-center text-xs"
                    >
                      {fmt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="label-mono">Anzeige</p>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-control)] border border-hairline bg-background/40 px-3 py-2 text-xs font-medium text-foreground">
                  <span>Name anzeigen</span>
                  <input
                    type="checkbox"
                    checked={options.showUser}
                    onChange={(event) =>
                      onOptionsChange((prev) => ({ ...prev, showUser: event.target.checked }))
                    }
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-control)] border border-hairline bg-background/40 px-3 py-2 text-xs font-medium text-foreground">
                  <span>Zahlen anzeigen</span>
                  <input
                    type="checkbox"
                    checked={options.showCounts}
                    onChange={(event) =>
                      onOptionsChange((prev) => ({ ...prev, showCounts: event.target.checked }))
                    }
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </label>
              </div>
            </div>

            {/* 5. Export Actions */}
            <div className="flex flex-col gap-2 border-t border-hairline pt-4">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void handleDownloadPng()}
                className="action-primary min-h-11 w-full gap-2 bg-accent text-on-accent hover:bg-accent-hover"
              >
                {busyAction === "download" ? (
                  <SpinnerIcon width={17} height={17} className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <DownloadIcon width={17} height={17} />
                )}
                {busyAction === "download" ? "PNG wird erstellt…" : "PNG herunterladen"}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleCopyImage()}
                  className="action-secondary min-h-10 gap-1.5 px-3 text-xs"
                >
                  {busyAction === "copy-image" ? (
                    <SpinnerIcon width={15} height={15} className="animate-spin motion-reduce:animate-none" />
                  ) : copiedImage ? (
                    <CheckCircleIcon width={15} height={15} className="text-success" />
                  ) : (
                    <CopyIcon width={15} height={15} />
                  )}
                  {copiedImage ? "Kopiert" : "Bild kopieren"}
                </button>

                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleShareImage()}
                  className="action-secondary min-h-10 gap-1.5 px-3 text-xs"
                >
                  {busyAction === "share-image" ? (
                    <SpinnerIcon width={15} height={15} className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <ShareNodesIcon width={15} height={15} />
                  )}
                  Als Bild teilen
                </button>
              </div>

              {!supportsFileShare && (
                <p className="text-[11px] leading-snug text-muted">
                  Hinweis: Dein aktueller Browser unterstützt kein direktes Datei-Teilen (Web Share API) – nutze „PNG herunterladen“ oder „Bild kopieren“.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleCopyText()}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
                >
                  {copiedText ? (
                    <CheckCircleIcon width={14} height={14} className="text-success" />
                  ) : (
                    <CopyIcon width={14} height={14} />
                  )}
                  {copiedText ? "Text kopiert" : "Als Text kopieren"}
                </button>

                {onOpenStory && (
                  <button
                    type="button"
                    onClick={onOpenStory}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
                  >
                    <PlayIcon width={13} height={13} />
                    Story starten
                  </button>
                )}
              </div>

              {actionError && (
                <div role="alert" className="error-panel mt-1 text-xs [overflow-wrap:anywhere]">
                  {actionError}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export interface WrappedStudioModalProps extends WrappedStudioViewProps {
  open: boolean;
  onClose: () => void;
}

function WrappedStudioDialog({
  onClose,
  onOpenStory,
  ...viewProps
}: Omit<WrappedStudioModalProps, "open">) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(true, panelRef, onClose);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-backdrop/85 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[94dvh] w-full max-w-6xl flex-col rounded-t-[var(--radius-panel)] border border-hairline bg-panel shadow-[0_28px_80px_rgb(0_0_0/0.65)] outline-none animate-[sheetUp_.32s_var(--ease-out)_both] motion-reduce:animate-none max-sm:border-x-0 max-sm:border-b-0 sm:rounded-[var(--radius-panel)] sm:animate-[popIn_.2s_var(--ease-out)_both]"
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-2.5 h-[3px] w-8 shrink-0 rounded-full bg-foreground/20 sm:hidden"
        />
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-5 py-3.5 sm:px-6">
          <div className="min-w-0">
            <p className="label-mono text-accent">LoggeRythm Wrapped</p>
            <h2
              id={titleId}
              className="font-display truncate text-xl font-extrabold tracking-[-0.03em] sm:text-2xl"
            >
              Share-Card Studio
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {onOpenStory && (
              <button
                type="button"
                onClick={onOpenStory}
                className="action-secondary hidden min-h-9 gap-1.5 px-3 text-xs sm:inline-flex"
              >
                <PlayIcon width={14} height={14} />
                Story ansehen
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Card Studio schließen"
              className="action-icon h-10 min-h-10 w-10"
            >
              <CloseIcon width={18} height={18} />
            </button>
          </div>
        </div>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
          <WrappedStudioView
            {...viewProps}
            onOpenStory={onOpenStory}
            inModal
            onCloseModal={onClose}
          />
        </div>
      </div>
    </div>
  );
}

export default function WrappedStudioModal({
  open,
  onClose,
  ...rest
}: WrappedStudioModalProps) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<WrappedStudioDialog onClose={onClose} {...rest} />, document.body);
}
