"use client";

import { toast } from "@/store/toast";
import type { PartyState } from "@/types";

// The SSE payload is the REST PartyState plus host-authoritative playback
// fields. Co-located here because src/types.ts is off-limits.
export interface PartyPlayback {
  is_playing: boolean;
  position_sec: number;
  /** ISO-8601 timestamp of the last playback update, or null. */
  playback_updated_at: string | null;
}

export type PartyLiveState = PartyState & PartyPlayback;

/**
 * Host-only: broadcast play/pause + playhead position to the party. Lives here
 * (not in lib/api.ts, which this task must not edit) but mirrors its contract —
 * same-origin, cookie auth, and a loud throw on any non-2xx response.
 */
export async function patchPartyPlayback(
  code: string,
  isPlaying: boolean,
  positionSec: number,
): Promise<void> {
  const res = await fetch(`/api/party/${encodeURIComponent(code)}/playback`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_playing: isPlaying, position_sec: positionSec }),
  });
  if (!res.ok) {
    throw new Error(
      `Wiedergabe-Update fehlgeschlagen (${res.status} ${res.statusText}).`,
    );
  }
}

/**
 * Open an SSE connection to the party event stream. Returns a disposer that
 * closes the stream. The browser's EventSource auto-reconnects on transient
 * errors; we surface a toast when the link drops and again once it recovers, so
 * a broken live connection is never silently hidden.
 */
export function openPartyStream(
  code: string,
  onState: (state: PartyLiveState) => void,
): () => void {
  const url = `/api/party/${encodeURIComponent(code)}/events`;
  const source = new EventSource(url);
  // Track whether we're currently in a dropped state to avoid toast spam and to
  // announce recovery exactly once.
  let dropped = false;

  source.onopen = () => {
    if (dropped) {
      dropped = false;
      toast.success("Live-Verbindung zur Party wiederhergestellt.");
    }
  };

  source.onmessage = (ev: MessageEvent<string>) => {
    // Let a malformed frame throw loudly rather than swallow it — the browser
    // console will surface the parse error with the offending payload.
    const state = JSON.parse(ev.data) as PartyLiveState;
    onState(state);
  };

  source.onerror = () => {
    // EventSource keeps retrying while readyState === CONNECTING; it only stops
    // at CLOSED. Either way, warn the user once that live updates paused.
    if (!dropped) {
      dropped = true;
      toast.error(
        "Live-Verbindung zur Party unterbrochen – versuche erneut zu verbinden…",
      );
    }
  };

  return () => {
    source.onopen = null;
    source.onmessage = null;
    source.onerror = null;
    source.close();
  };
}
