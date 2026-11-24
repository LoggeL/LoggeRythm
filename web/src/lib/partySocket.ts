"use client";

import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import type { PartyState } from "@/types";

export type PartyLiveState = PartyState;

export type PartyStreamStatus = "connecting" | "live" | "reconnecting" | "error";

export async function patchPartyPlayback(
  code: string,
  isPlaying: boolean,
  positionSec: number,
): Promise<void> {
  await api.partyPatchPlayback(code, isPlaying, positionSec);
}

/** Validate an incoming SSE PartyState frame loudly instead of accepting corrupt data. */
function parsePartyFrame(raw: string): PartyLiveState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `Ungültiger Party-Stream-Frame (kein JSON): ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>).code !== "string" ||
    !Array.isArray((parsed as Record<string, unknown>).tracks) ||
    !Array.isArray((parsed as Record<string, unknown>).members)
  ) {
    throw new Error("Ungültiger Party-Stream-Frame: code, tracks und members werden erwartet.");
  }
  return parsed as PartyLiveState;
}

/**
 * Open an SSE connection to the party event stream. Returns a disposer that
 * closes the stream. Connection drops and frame parse failures are surfaced
 * loudly via callbacks and toasts so broken live sync is never hidden.
 */
export function openPartyStream(
  code: string,
  onState: (state: PartyLiveState) => void,
  options?: {
    onStatus?: (status: PartyStreamStatus, error?: string | null) => void;
    onFrameError?: (error: Error) => void;
  },
): () => void {
  const url = `/api/party/${encodeURIComponent(code)}/events`;
  const source = new EventSource(url);
  let dropped = false;
  options?.onStatus?.("connecting", null);

  source.onopen = () => {
    options?.onStatus?.("live", null);
    if (dropped) {
      dropped = false;
      toast.success("Live-Verbindung zur Jam wiederhergestellt.");
    }
  };

  source.onmessage = (ev: MessageEvent<string>) => {
    let state: PartyLiveState;
    try {
      state = parsePartyFrame(ev.data);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      options?.onStatus?.("error", error.message);
      options?.onFrameError?.(error);
      toast.error(error.message);
      throw error;
    }
    options?.onStatus?.("live", null);
    onState(state);
  };

  source.onerror = () => {
    const closed = source.readyState === EventSource.CLOSED;
    const message = closed
      ? "Live-Verbindung zur Jam wurde beendet."
      : "Live-Verbindung zur Jam unterbrochen – versuche erneut zu verbinden…";
    options?.onStatus?.(closed ? "error" : "reconnecting", message);
    if (!dropped) {
      dropped = true;
      toast.error(message);
    }
  };

  return () => {
    source.onopen = null;
    source.onmessage = null;
    source.onerror = null;
    source.close();
  };
}
