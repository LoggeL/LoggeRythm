"use client";

import { DownloadedIcon } from "@/components/icons";
import { useTrackCacheState } from "@/store/downloads";

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
  if (!state) return null;
  const local = state === "local";
  return (
    <span
      title={
        local
          ? "Offline auf diesem Gerät verfügbar"
          : "Auf dem Server gespeichert"
      }
      className={`inline-flex flex-shrink-0 ${
        local ? "text-green-500" : "text-muted"
      } ${className}`}
    >
      <DownloadedIcon
        aria-label={local ? "Offline verfügbar" : "Auf dem Server gespeichert"}
      />
    </span>
  );
}
