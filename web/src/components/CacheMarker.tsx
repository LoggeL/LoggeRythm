"use client";

import { DownloadedIcon } from "@/components/icons";
import { reportTrackCacheFailure, retryTrackCacheStatus, useTrackCacheError, useTrackCacheState } from "@/store/downloads";

/**
 * Availability marker for a track:
 * - green disc → cached offline on this device (takes precedence)
 * - muted disc → stored on the server (no Deezer re-fetch needed)
 * Renders nothing when the track is neither.
 */
export default function CacheMarker({
  trackId,
  className = "",
}: {
  trackId: string | number;
  className?: string;
}) {
  const state = useTrackCacheState(trackId);
  const error = useTrackCacheError();
  if (!state && !error) return null;
  const local = state === "local";
  return (
    <span className={`inline-flex items-center gap-1 flex-shrink-0 ${className}`}>
      {state && (
        <span
          title={local ? "Offline auf diesem Gerät verfügbar" : "Auf dem Server gespeichert"}
          className={`inline-flex ${local ? "text-green-500" : "text-muted"}`}
        >
          <DownloadedIcon aria-label={local ? "Offline verfügbar" : "Auf dem Server gespeichert"} />
        </span>
      )}
      {error && <button
        type="button"
        title={`${error} Erneut versuchen.`}
        aria-label={`Cache-Status fehlgeschlagen: ${error}. Erneut versuchen.`}
        className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-amber-400/40 text-xs font-semibold text-amber-300"
        onClick={(event) => {
          event.stopPropagation();
          void retryTrackCacheStatus().catch(reportTrackCacheFailure);
        }}
      >
        !
      </button>}
    </span>
  );
}
