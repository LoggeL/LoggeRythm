"use client";

import { useEffect } from "react";
import { usePlayerStore } from "@/store/player";
import { usePartyStore } from "@/store/party";
import { toast } from "@/store/toast";
import { partyFailureMessage } from "../requests";

/** Seconds a guest may drift from the host before it is pulled back. */
const MAX_DRIFT_SEC = 1.5;

/**
 * Keeps party playback in step. The host broadcasts play/pause, track changes
 * and a periodic position tick; guests follow that broadcast and only seek
 * when they drift noticeably, so small network jitter stays inaudible.
 */
export function usePartyPlaybackSync(
  code: string,
  isHost: boolean,
  joined: boolean,
  setPlayback: (isPlaying: boolean, positionSec: number) => Promise<void>,
) {
  const followHostPlayback = usePlayerStore((s) => s.followHostPlayback);
  // Host-authoritative playback mirrored from the SSE stream.
  const hostIsPlaying = usePartyStore((s) => s.isPlaying);
  const hostPosition = usePartyStore((s) => s.positionSec);
  const hostUpdatedAt = usePartyStore((s) => s.playbackUpdatedAt);

  useEffect(() => {
    if (!code || !isHost) return;
    const broadcast = () => {
      const player = usePlayerStore.getState();
      setPlayback(player.isPlaying, player.currentTime).catch((error: unknown) => {
        toast.error(partyFailureMessage("Wiedergabe konnte nicht an die Party gesendet werden", error));
      });
    };
    const unsubscribe = usePlayerStore.subscribe((state, previous) => {
      if (state.isPlaying !== previous.isPlaying || state.index !== previous.index) broadcast();
    });
    const interval = window.setInterval(broadcast, 3000);
    broadcast();
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [code, isHost, setPlayback]);

  useEffect(() => {
    if (!code || isHost || !joined) return;
    const reconcile = () => {
      const player = usePlayerStore.getState();
      if (player.index < 0) return;
      // Account for the time that passed since the host's last update.
      const expected =
        hostIsPlaying && hostUpdatedAt != null ? hostPosition + (Date.now() - hostUpdatedAt) / 1000 : hostPosition;
      const seekTo = Math.abs(player.currentTime - expected) > MAX_DRIFT_SEC ? Math.max(0, expected) : null;
      if (player.isPlaying !== hostIsPlaying || seekTo != null) followHostPlayback(hostIsPlaying, seekTo);
    };
    reconcile();
    const interval = window.setInterval(reconcile, 1000);
    return () => window.clearInterval(interval);
  }, [code, isHost, joined, hostIsPlaying, hostPosition, hostUpdatedAt, followHostPlayback]);
}
