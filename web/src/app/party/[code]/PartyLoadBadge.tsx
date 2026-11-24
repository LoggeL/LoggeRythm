import { ClockIcon, SpinnerIcon } from "@/components/icons";
import { AlertCircleIcon } from "@/components/feedbackIcons";
import type { PartyLoadState } from "@/types";

/**
 * Transient preload/buffer/error indicator for a party track.
 * Stored/downloaded state is rendered by the normal `<CacheMarker />` in
 * `PartyTrackRow`, so `ready` and `idle` render nothing here; only active
 * loading/queued/buffering work and explicit failures are shown.
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
  const key: "buffering" | "loading" | "queued" | "failed" | null =
    state === "failed"
      ? "failed"
      : buffering
        ? "buffering"
        : state === "loading"
          ? "loading"
          : state === "queued"
            ? "queued"
            : null;

  if (!key) return null;

  if (key === "failed") {
    const title = error ? `Laden fehlgeschlagen: ${error}` : "Laden fehlgeschlagen";
    return (
      <span
        title={title}
        aria-label={title}
        data-load-state="failed"
        className="inline-flex shrink-0 items-center gap-1 font-mono text-[0.625rem] font-medium uppercase tracking-[0.12em] text-danger"
      >
        <AlertCircleIcon width={13} height={13} aria-hidden />
        <span aria-hidden="true">Fehler</span>
      </span>
    );
  }

  if (key === "queued") {
    const title = "Wird als Nächstes im Hintergrund vorgeladen";
    return (
      <span
        title={title}
        aria-label={title}
        data-load-state="queued"
        className="inline-flex shrink-0 items-center text-muted"
      >
        <ClockIcon width={13} height={13} aria-hidden />
      </span>
    );
  }

  const title =
    key === "buffering"
      ? "Dein Player puffert diesen Titel gerade"
      : "Wird gerade auf dem Server vorgeladen";
  return (
    <span
      title={title}
      aria-label={title}
      data-load-state={key}
      className="inline-flex shrink-0 items-center text-accent"
    >
      <SpinnerIcon width={13} height={13} aria-hidden className="animate-spin motion-reduce:animate-none" />
    </span>
  );
}
