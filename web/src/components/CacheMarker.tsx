"use client";

import { DownloadedIcon } from "@/components/icons";
import Tooltip from "@/components/ui/Tooltip";
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
  serverStored = false,
  skipStoreFetch = false,
  externalError = null,
  onRetryExternal,
}: {
  trackId: string | number;
  className?: string;
  /** Authoritative server-stored flag (e.g. `PartyTrack.is_stored` or guest party cached-tracks). */
  serverStored?: boolean;
  /** Anonymous party guests cannot call `/api/cached-tracks`; use party-scoped status instead. */
  skipStoreFetch?: boolean;
  /** Explicit cache-lookup failure from an external source (e.g. `/api/party/{code}/cached-tracks`). */
  externalError?: string | null;
  onRetryExternal?: () => void | Promise<void>;
}) {
  const storeState = useTrackCacheState(trackId, !skipStoreFetch);
  const storeError = useTrackCacheError();
  const state = skipStoreFetch
    ? (serverStored ? "server" : null)
    : storeState === "local"
      ? "local"
      : storeState === "server" || serverStored
        ? "server"
        : null;
  const error = skipStoreFetch ? externalError : (externalError ?? storeError);
  if (!state && !error) return null;
  const local = state === "local";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 ${className}`}>
      {state && (
        <Tooltip label={local ? "Offline auf diesem Gerät verfügbar" : "Auf dem Server gespeichert"}>
          <span className={`inline-flex ${local ? "text-success" : "text-subtle"}`}>
            <DownloadedIcon aria-label={local ? "Offline verfügbar" : "Auf dem Server gespeichert"} />
          </span>
        </Tooltip>
      )}
      {error && (
        <button
          type="button"
          title={`${error} Erneut versuchen.`}
          aria-label={`Cache-Status fehlgeschlagen: ${error}. Erneut versuchen.`}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-danger/40 text-xs font-semibold text-danger"
          onClick={(event) => {
            event.stopPropagation();
            if (skipStoreFetch && onRetryExternal) {
              void Promise.resolve(onRetryExternal()).catch(reportTrackCacheFailure);
            } else {
              void retryTrackCacheStatus().catch(reportTrackCacheFailure);
            }
          }}
        >
          !
        </button>
      )}
    </span>
  );
}
