"use client";

import { useEffect, useRef } from "react";
import { ApiError, api } from "@/lib/api";
import { openPartyStream } from "@/lib/partySocket";
import { useMe } from "@/hooks/useAuth";
import { mergeServerCachedTrackIds } from "@/store/downloads";
import { usePartyStore } from "@/store/party";
import { usePlayerStore } from "@/store/player";
import { useConnectStore } from "@/store/connect";
import { toast } from "@/store/toast";
import type { PartyState, PartyTrack, Track } from "@/types";
import { partyFailureMessage } from "@/app/party/requests";

/** Seconds a listening guest may drift from the host before seeking. */
const MAX_DRIFT_SEC = 1.5;

function partyTrackToTrack(pt: PartyTrack): Track {
  return {
    id: pt.deezer_id,
    title: pt.title,
    artist: pt.artist,
    artist_id: pt.artist_id,
    artists: pt.artists,
    album: pt.album,
    album_id: pt.album_id,
    cover: pt.cover,
    duration_sec: pt.duration_sec,
  };
}

/**
 * Workspace-level Jam session manager. Keeps an active Jam alive across route
 * navigations, syncs playback (including host conflict resolution when
 * `guests_can_control` is enabled), enforces "Listen locally" vs "Control only"
 * for non-host members, and advertises `party_code` to the Connect hub.
 */
export default function PartySessionManager() {
  const { data: me } = useMe();
  const code = usePartyStore((s) => s.code);
  const active = usePartyStore((s) => s.active);
  const party = usePartyStore((s) => s.party);
  const isHost = usePartyStore((s) => s.isHost);
  const guestsCanControl = usePartyStore((s) => s.guestsCanControl);
  const listenLocally = usePartyStore((s) => s.listenLocally);
  const hostIsPlaying = usePartyStore((s) => s.isPlaying);
  const hostPosition = usePartyStore((s) => s.positionSec);
  const hostUpdatedAt = usePartyStore((s) => s.playbackUpdatedAt);
  const connectStatus = useConnectStore((s) => s.status);

  const lastAppliedRevision = useRef<number>(0);
  const applyingPartyFrameDepth = useRef<number>(0);
  const restoredForUser = useRef<string | null>(null);

  // Restore any active Jam for the signed-in user once per account session.
  useEffect(() => {
    const userKey = me?.is_approved ? String(me.id) : null;
    if (!userKey) return;
    if (restoredForUser.current === userKey) return;
    restoredForUser.current = userKey;
    let mounted = true;
    api
      .activeParty()
      .then((found) => {
        if (!mounted || !found || found.ended) return;
        const current = usePartyStore.getState();
        if (current.code && current.code !== found.code) return;
        lastAppliedRevision.current = found.playback_revision ?? 0;
        current.setActiveCode(found.code);
        current.applyPartyState(found);
      })
      .catch((cause: unknown) => {
        if (!mounted) return;
        const message = partyFailureMessage("Aktive Jam konnte nicht geprüft werden", cause);
        usePartyStore.getState().setStreamStatus("error", message);
        toast.error(message);
      });
    return () => {
      mounted = false;
    };
  }, [me?.id, me?.is_approved]);

  // Advertise party membership to the personal Connect hub so other devices see it.
  useEffect(() => {
    if (connectStatus !== "connected") return;
    useConnectStore.getState().actions?.syncPartyCode(active && code ? code : null);
  }, [active, code, connectStatus]);

  // Keep SSE stream + safety poll running while a Jam code is active.
  useEffect(() => {
    if (!code || !me?.is_approved) return;
    lastAppliedRevision.current = usePartyStore.getState().playbackRevision;
    let disposed = false;

    const handleIncomingState = (next: PartyState) => {
      if (disposed) return;

      if (next.ended) {
        usePlayerStore.getState().setPartyBridge(null);
        usePlayerStore.getState().setSuppressLocalAudio(false);
        usePartyStore.getState().markEnded("Die Jam wurde vom Host beendet.", next.code);
        toast.info("Die Jam wurde vom Host beendet.");
        return;
      }

      // Detect if the host kicked this member (when members carry stable actor keys).
      const hasKeys = next.members.length > 0 && next.members.every((m) => Boolean(m.key));
      if (hasKeys && next.viewer_key && !next.members.some((m) => m.key === next.viewer_key)) {
        usePlayerStore.getState().setPartyBridge(null);
        usePlayerStore.getState().setSuppressLocalAudio(false);
        usePartyStore.getState().markEnded("Du wurdest vom Host aus der Jam entfernt.", next.code);
        toast.error("Du wurdest vom Host aus der Jam entfernt.");
        return;
      }

      const storedIds = next.tracks
        .filter((track) => track.is_stored || track.load_state === "ready")
        .map((track) => track.deezer_id);
      if (storedIds.length > 0) mergeServerCachedTrackIds(storedIds);

      const tracks = next.tracks.map(partyTrackToTrack);
      const itemIds = next.tracks.map((entry) => entry.id);

      // Guard both setPartyQueue and followHostPlayback so the host's player
      // subscriber never echoes an incoming Jam frame back to PATCH /playback
      // and clobbers a participant's remote change under guests_can_control.
      applyingPartyFrameDepth.current += 1;
      try {
        usePlayerStore.getState().setPartyQueue(tracks, next.current_index, itemIds);

        const rev = next.playback_revision ?? 0;
        if (
          next.is_host &&
          rev > lastAppliedRevision.current &&
          next.playback_changed_by &&
          next.playback_changed_by !== next.viewer_key
        ) {
          lastAppliedRevision.current = rev;
          usePlayerStore.getState().followHostPlayback(next.is_playing, next.position_sec);
        } else if (rev > lastAppliedRevision.current) {
          lastAppliedRevision.current = rev;
        }
      } finally {
        applyingPartyFrameDepth.current -= 1;
      }

      usePartyStore.getState().applyPartyState(next);
    };

    const fetchLatest = () => {
      api
        .getParty(code)
        .then(handleIncomingState)
        .catch((cause: unknown) => {
          if (disposed) return;
          if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) {
            const reason =
              cause.status === 404
                ? "Diese Jam wurde beendet."
                : "Du bist nicht mehr Teil dieser Jam.";
            usePlayerStore.getState().setPartyBridge(null);
            usePlayerStore.getState().setSuppressLocalAudio(false);
            usePartyStore.getState().markEnded(reason, code);
            toast.error(reason);
            return;
          }
          const message = partyFailureMessage("Jam-Status konnte nicht aktualisiert werden", cause);
          usePartyStore.getState().setStreamStatus("error", message);
        });
    };

    const existing = usePartyStore.getState().party;
    if (!existing || existing.code !== code) {
      fetchLatest();
    } else {
      handleIncomingState(existing);
    }

    const disposeStream = openPartyStream(code, handleIncomingState, {
      onStatus: (status, err) => {
        if (!disposed) usePartyStore.getState().setStreamStatus(status, err ?? null);
      },
      onFrameError: (err) => {
        if (!disposed) usePartyStore.getState().setStreamStatus("error", err.message);
      },
    });

    const safetyPoll = window.setInterval(fetchLatest, 20_000);

    return () => {
      disposed = true;
      disposeStream();
      window.clearInterval(safetyPoll);
      usePlayerStore.getState().setPartyBridge(null);
      // Restore local audio unless Connect remote controller owns suppression.
      const player = usePlayerStore.getState();
      if (!player.remoteBridge) {
        player.setSuppressLocalAudio(false);
      }
    };
  }, [code, me?.is_approved]);

  // Install/refresh PartyBridge & local audio suppression whenever Jam permissions or tracks change.
  useEffect(() => {
    if (!code || !party || !active) {
      usePlayerStore.getState().setPartyBridge(null);
      return;
    }
    const items = party.tracks;
    const canControl = isHost || guestsCanControl;
    const suppressLocal = !isHost && !listenLocally;
    usePlayerStore.getState().setSuppressLocalAudio(suppressLocal);

    const sendRemotePlayback = (nextPlaying: boolean, nextPos?: number) => {
      if (!canControl) {
        toast.info(`${party.host_name} steuert die Wiedergabe dieser Jam.`);
        return;
      }
      const pos = nextPos ?? usePlayerStore.getState().currentTime;
      api.partyPatchPlayback(code, nextPlaying, pos).catch((error: unknown) => {
        toast.error(partyFailureMessage("Wiedergabe-Update fehlgeschlagen", error));
      });
    };

    usePlayerStore.getState().setPartyBridge({
      addToQueue: (t) => {
        api.partyAddTrack(code, t, "end").catch((error: unknown) => {
          toast.error(partyFailureMessage(`"${t.title}" konnte nicht hinzugefügt werden`, error));
        });
      },
      playNext: (t) => {
        api.partyAddTrack(code, t, "next").catch((error: unknown) => {
          toast.error(partyFailureMessage(`"${t.title}" konnte nicht als Nächstes eingereiht werden`, error));
        });
      },
      removeAt: (i) => {
        const item = items[i];
        if (!item) return;
        api.partyRemoveTrack(code, item.id).catch((error: unknown) => {
          toast.error(partyFailureMessage(`"${item.title}" konnte nicht entfernt werden`, error));
        });
      },
      reorder: (from, to) => {
        const ids = items.map((it) => it.id);
        if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return;
        const [moved] = ids.splice(from, 1);
        ids.splice(to, 0, moved);
        api.partyReorder(code, ids).catch((error: unknown) => {
          toast.error(partyFailureMessage("Reihenfolge konnte nicht geändert werden", error));
        });
      },
      setCurrent: (i) => {
        if (!canControl) {
          toast.info(`${party.host_name} steuert die Wiedergabe dieser Jam.`);
          return;
        }
        api.partySetCurrent(code, i).catch((error: unknown) => {
          toast.error(partyFailureMessage("Titelwechsel fehlgeschlagen", error));
        });
      },
      // Host controls local audio directly and broadcasts below; non-hosts either
      // send remote playback updates (when allowed) or see a clear host-lock notice.
      ...(!isHost
        ? {
            toggle: () => sendRemotePlayback(!usePartyStore.getState().isPlaying),
            play: () => sendRemotePlayback(true),
            pause: () => sendRemotePlayback(false),
            seek: (t: number) => sendRemotePlayback(usePartyStore.getState().isPlaying, t),
          }
        : {}),
    });
  }, [code, party, active, isHost, guestsCanControl, listenLocally]);

  // Host: broadcast playback transitions, manual seeks, and periodic heartbeats.
  useEffect(() => {
    if (!code || !active || !isHost) return;
    const broadcast = (posOverride?: number) => {
      const player = usePlayerStore.getState();
      const pos = posOverride ?? player.currentTime;
      api.partyPatchPlayback(code, player.isPlaying, pos).catch((error: unknown) => {
        toast.error(partyFailureMessage("Wiedergabe konnte nicht an die Jam gesendet werden", error));
      });
    };
    const unsubscribe = usePlayerStore.subscribe((state, previous) => {
      if (applyingPartyFrameDepth.current > 0) return;
      if (state.isPlaying !== previous.isPlaying || state.index !== previous.index) {
        broadcast(state.seekTo ?? state.currentTime);
      } else if (state.seekTo !== null && state.seekTo !== previous.seekTo) {
        broadcast(state.seekTo);
      }
    });
    const interval = window.setInterval(() => broadcast(), 3000);
    broadcast();
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [code, active, isHost]);

  // Non-host signed-in member: follow host playback (locally or display-only).
  useEffect(() => {
    if (!code || !active || isHost) return;
    const reconcile = () => {
      const player = usePlayerStore.getState();
      if (player.index < 0) return;
      const expected =
        hostIsPlaying && hostUpdatedAt != null
          ? hostPosition + Math.max(0, (Date.now() - hostUpdatedAt) / 1000)
          : hostPosition;
      const clamped = player.duration > 0 ? Math.min(expected, player.duration) : Math.max(0, expected);
      if (!listenLocally) {
        if (player.isPlaying !== hostIsPlaying) {
          player.followHostPlayback(hostIsPlaying, null);
        }
        player._setCurrentTime(clamped);
        return;
      }
      const seekTo = Math.abs(player.currentTime - clamped) > MAX_DRIFT_SEC ? clamped : null;
      if (player.isPlaying !== hostIsPlaying || seekTo != null) {
        player.followHostPlayback(hostIsPlaying, seekTo);
      }
    };
    reconcile();
    const interval = window.setInterval(reconcile, 1000);
    return () => window.clearInterval(interval);
  }, [code, active, isHost, listenLocally, hostIsPlaying, hostPosition, hostUpdatedAt]);

  return null;
}
