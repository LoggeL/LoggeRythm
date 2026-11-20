import { ClockIcon, DownloadedIcon, SpinnerIcon } from "@/components/icons";
import { AlertCircleIcon } from "@/components/feedbackIcons";
import type { PartyLoadState } from "@/types";

const LABELS: Record<PartyLoadState | "buffering", { text: string; title: string; className: string }> = {
  ready: { text: "Geladen", title: "Auf dem Server geladen – startet ohne Wartezeit", className: "text-success" },
  loading: { text: "Lädt", title: "Wird gerade im Hintergrund geladen", className: "text-accent" },
  buffering: { text: "Puffert", title: "Dein Player puffert diesen Titel gerade", className: "text-accent" },
  queued: { text: "Wartet", title: "Wird als Nächstes im Hintergrund geladen", className: "text-muted" },
  idle: { text: "Nicht geladen", title: "Noch nicht vorgeladen", className: "text-subtle" },
  failed: { text: "Fehler", title: "Laden fehlgeschlagen", className: "text-danger" },
};

/**
 * Whether a party track's audio is ready: loaded on the server, loading in the
 * background, waiting for its turn, or failed (the cause is in the tooltip and
 * the accessible label). `buffering` marks the playing track while the
 * viewer's own player is still buffering it.
 */
export default function PartyLoadBadge({
  state,
  error,
  buffering = false,
}: {
  state: PartyLoadState;
  error: string | null;
  buffering?: boolean;
}) {
  const key = buffering && state !== "failed" ? "buffering" : state;
  const label = LABELS[key];
  const title = key === "failed" && error ? `${label.title}: ${error}` : label.title;
  const busy = key === "loading" || key === "buffering";
  return (
    <span
      title={title}
      aria-label={title}
      data-load-state={key}
      className={`inline-flex shrink-0 items-center gap-1 font-mono text-[0.625rem] font-medium uppercase tracking-[0.12em] ${label.className}`}
    >
      {busy ? (
        <SpinnerIcon width={12} height={12} aria-hidden className="animate-spin motion-reduce:animate-none" />
      ) : key === "ready" ? (
        <DownloadedIcon width={12} height={12} aria-hidden />
      ) : key === "failed" ? (
        <AlertCircleIcon width={12} height={12} aria-hidden />
      ) : (
        <ClockIcon width={12} height={12} aria-hidden />
      )}
      <span aria-hidden="true">{label.text}</span>
    </span>
  );
}
