"use client";

import { useEffect, useRef } from "react";
import { useMe } from "@/hooks/useAuth";
import { ConnectSocket } from "@/lib/connectSocket";
import {
  interpolatedPositionSec,
  normalizeConnectTrack,
  type ConnectServerMessage,
} from "@/lib/connectProtocol";
import {
  buildConnectPlaybackSnapshot,
  executeLocalConnectCommand,
} from "@/lib/connectCommands";
import {
  activeRemoteDevice,
  canControlActiveVolume,
  isControllingRemoteDevice,
  useConnectStore,
} from "@/store/connect";
import { usePartyStore } from "@/store/party";
import { usePlayerStore, type RemotePlaybackBridge, type RepeatMode } from "@/store/player";
import { toast } from "@/store/toast";
import type { ConnectCommandAction } from "@/types";

const HEARTBEAT_PUBLISH_MS = 4000;
const VOLUME_DEBOUNCE_MS = 150;

/**
 * Pure helper exported for unit testing: builds a RemotePlaybackBridge that
 * forwards playback & queue commands over WS and respects remote volume
 * capabilities (preventing keyboard shortcuts from mutating volume on devices
 * with `can_control_volume === false`).
 */
export function createConnectRemoteBridge(
  dispatch: (action: ConnectCommandAction, payload?: Record<string, unknown>) => void,
  onVolumeUnsupported?: (deviceName: string) => void,
): RemotePlaybackBridge {
  const guardRemoteVolume = (): boolean => {
    const connect = useConnectStore.getState();
    if (canControlActiveVolume(connect)) return true;
    const remote = activeRemoteDevice(connect);
    const name = remote?.name ?? "dem Zielgerät";
    if (onVolumeUnsupported) onVolumeUnsupported(name);
    else toast.info(`Lautstärke wird direkt auf „${name}“ geregelt.`);
    return false;
  };

  return {
    playTrack: (track) =>
      dispatch("play_tracks", {
        tracks: [normalizeConnectTrack(track)],
        start_index: 0,
        queue_context: null,
        origins: ["context"],
      }),
    playQueue: (tracks, startIndex = 0, context) =>
      dispatch("play_tracks", {
        tracks: tracks.map(normalizeConnectTrack),
        start_index: Math.max(0, Math.min(startIndex, tracks.length - 1)),
        queue_context: context ?? null,
        origins: tracks.map(() => "context"),
      }),
    addToQueue: (track) => dispatch("queue_add", { track: normalizeConnectTrack(track) }),
    playNext: (track) => dispatch("queue_play_next", { track: normalizeConnectTrack(track) }),
    removeFromQueue: (index) => dispatch("queue_remove", { index }),
    clearQueue: () => dispatch("clear_queue", {}),
    reorderQueue: (fromIndex, toIndex) =>
      dispatch("queue_reorder", { from_index: fromIndex, to_index: toIndex }),
    jumpTo: (index) => dispatch("select_index", { index }),
    toggle: () => dispatch("toggle", {}),
    play: () => dispatch("play", {}),
    pause: () => dispatch("pause", {}),
    next: () => dispatch("next", {}),
    prev: () => dispatch("prev", {}),
    seek: (positionSec) => dispatch("seek", { position_sec: positionSec }),
    setVolume: (volume) => {
      if (!guardRemoteVolume()) return;
      const clamped = Math.max(0, Math.min(1, volume));
      usePlayerStore.setState({ volume: clamped, muted: clamped === 0 });
      dispatch("set_volume", { volume: clamped });
    },
    toggleMute: () => {
      if (!guardRemoteVolume()) return;
      const nextMuted = !usePlayerStore.getState().muted;
      usePlayerStore.setState({ muted: nextMuted });
      dispatch("set_mute", { muted: nextMuted });
    },
    toggleShuffle: () => {
      const nextShuffle = !usePlayerStore.getState().shuffle;
      dispatch("set_shuffle", { shuffle: nextShuffle });
    },
    cycleRepeat: () => {
      const order: RepeatMode[] = ["off", "all", "one"];
      const cur = usePlayerStore.getState().repeat;
      const nextRepeat = order[(order.indexOf(cur) + 1) % order.length];
      dispatch("set_repeat", { repeat: nextRepeat });
    },
  };
}

/** True when this browser is actively following someone else's Jam (must never claim personal Connect active). */
export function isNonHostJamFollower(party: { active: boolean; isHost: boolean; detached?: boolean }): boolean {
  return party.active && !party.detached && !party.isHost;
}

/**
 * Pure decision helper for Async Connect Continuity (S3.1): when all devices
 * were offline and this tab receives a server-persisted `UserPlaybackState` on
 * `welcome`, hydrate it paused into an idle local player so cross-device queues
 * survive reloads & offline handoffs immediately.
 */
export function shouldHydrateServerPlayback(params: {
  activeDeviceId: string | null;
  playback: { queue: readonly unknown[]; current_index: number } | null;
  localQueueLength: number;
  partyOwnsPlayback: boolean;
}): boolean {
  if (params.partyOwnsPlayback) return false;
  if (params.activeDeviceId !== null) return false;
  if (params.localQueueLength > 0) return false;
  if (!params.playback) return false;
  return (
    params.playback.queue.length > 0 &&
    params.playback.current_index >= 0 &&
    params.playback.current_index < params.playback.queue.length
  );
}

/**
 * Headless WebSocket Connect controller mounted inside the authenticated
 * Workspace. Registers this browser tab as a Connect device, handles transfers,
 * remote commands, remote-controller bridging, and active state publishing.
 */
export default function ConnectEngine() {
  const { data: me } = useMe();
  const enabled = useConnectStore((s) => s.enabled);
  const status = useConnectStore((s) => s.status);
  const activeDeviceId = useConnectStore((s) => s.activeDeviceId);
  const deviceId = useConnectStore((s) => s.deviceId);
  const playback = useConnectStore((s) => s.playback);
  const clockOffsetMs = useConnectStore((s) => s.clockOffsetMs);
  const partyOwnsPlayback = usePartyStore((s) => s.active && !s.detached);

  const socketRef = useRef<ConnectSocket | null>(null);
  const applyingRemoteDepthRef = useRef(0);
  const volumePublishTimer = useRef<number | null>(null);

  const runWhileApplyingRemote = (fn: () => void) => {
    applyingRemoteDepthRef.current += 1;
    try {
      fn();
    } finally {
      applyingRemoteDepthRef.current -= 1;
    }
  };

  // Hydrate persistent tab device ID + stored device name + enabled preference once.
  useEffect(() => {
    try {
      useConnectStore.getState().hydrateIdentity();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      useConnectStore.getState().setStatus("error", message);
      toast.error(message);
    }
  }, []);

  // Open / tear down the Connect WebSocket for approved logged-in users.
  useEffect(() => {
    const approved = Boolean(me?.is_approved);
    if (!approved || !enabled) {
      socketRef.current?.dispose();
      socketRef.current = null;
      useConnectStore.getState().setActions(null);
      if (!approved) {
        useConnectStore.getState().resetSession();
      } else {
        useConnectStore.getState().setStatus("disabled", null);
      }
      const player = usePlayerStore.getState();
      if (player.remoteBridge) {
        player.setRemoteBridge(null);
        const party = usePartyStore.getState();
        if (!(party.active && !party.detached)) {
          player.setSuppressLocalAudio(false);
        }
      }
      return;
    }

    const store = useConnectStore.getState();
    if (!store.deviceId) store.hydrateIdentity();

    const publishPlayback = (claimActive = false) => {
      const sock = socketRef.current;
      if (!sock?.isOpen()) return;
      if (applyingRemoteDepthRef.current > 0) return;
      if (isNonHostJamFollower(usePartyStore.getState())) return;
      const connect = useConnectStore.getState();
      if (!claimActive && connect.activeDeviceId !== connect.deviceId) return;
      const snapshot = buildConnectPlaybackSnapshot(usePlayerStore.getState());
      try {
        sock.send({
          type: "playback_state",
          ...(claimActive ? { claim_active: true } : {}),
          state: snapshot,
        });
      } catch (cause) {
        toast.error(`Connect-Status konnte nicht gesendet werden: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    };

    const sendCommand = async (
      action: ConnectCommandAction,
      payload: Record<string, unknown> = {},
      targetDeviceId?: string | null,
    ) => {
      const sock = socketRef.current;
      if (!sock) throw new Error("Connect-WebSocket ist nicht aktiv.");
      await sock.sendWithAck(
        (requestId) => ({
          type: "command",
          request_id: requestId,
          ...(targetDeviceId !== undefined ? { target_device_id: targetDeviceId } : {}),
          action,
          payload,
        }),
        `Connect-Befehl "${action}"`,
      );
    };

    const runRemoteCommand = (action: ConnectCommandAction, payload?: Record<string, unknown>) => {
      void sendCommand(action, payload).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    };

    const buildRemoteBridge = () => createConnectRemoteBridge(runRemoteCommand);

    const syncRemoteBridgeFromState = () => {
      const connect = useConnectStore.getState();
      const party = usePartyStore.getState();
      const player = usePlayerStore.getState();

      // Jam mode owns playback while active and attached.
      if (party.active && !party.detached) {
        if (player.remoteBridge) player.setRemoteBridge(null);
        return;
      }

      if (isControllingRemoteDevice(connect) && connect.playback) {
        if (!player.remoteBridge) {
          player.setRemoteBridge(buildRemoteBridge());
        }
        if (!player.suppressLocalAudio) {
          player.setSuppressLocalAudio(true);
        }
        runWhileApplyingRemote(() => {
          const pos = interpolatedPositionSec(
            connect.playback as NonNullable<typeof connect.playback>,
            Date.now(),
            connect.clockOffsetMs,
          );
          player.applyRemotePlaybackState(
            connect.playback as NonNullable<typeof connect.playback>,
            pos,
          );
        });
      } else {
        if (player.remoteBridge) player.setRemoteBridge(null);
        if (player.suppressLocalAudio) player.setSuppressLocalAudio(false);
      }
    };

    const handleServerMessage = (msg: ConnectServerMessage) => {
      switch (msg.type) {
        case "welcome": {
          useConnectStore.getState().applyServerState(msg.state, msg.self_device_id);
          const party = usePartyStore.getState();
          const player = usePlayerStore.getState();
          if (
            shouldHydrateServerPlayback({
              activeDeviceId: msg.state.active_device_id,
              playback: msg.state.playback,
              localQueueLength: player.queue.length,
              partyOwnsPlayback: party.active && !party.detached,
            })
          ) {
            runWhileApplyingRemote(() => {
              player.applyRemotePlaybackState(
                { ...msg.state.playback, is_playing: false },
                msg.state.playback.position_sec,
              );
            });
          }
          syncRemoteBridgeFromState();
          return;
        }
        case "state":
          useConnectStore.getState().applyServerState(msg.state);
          syncRemoteBridgeFromState();
          return;
        case "activate": {
          const party = usePartyStore.getState();
          if (party.active && !party.detached) {
            toast.info("Wiedergabe-Übertragung ignoriert, solange eine Jam aktiv ist.");
            return;
          }
          runWhileApplyingRemote(() => {
            usePlayerStore.getState().activateConnectPlayback(msg.playback);
          });
          window.setTimeout(() => publishPlayback(false), 50);
          return;
        }
        case "deactivated": {
          const party = usePartyStore.getState();
          if (!party.active || party.detached) {
            const player = usePlayerStore.getState();
            player.setSuppressLocalAudio(true);
            player.setRemoteBridge(buildRemoteBridge());
          }
          if (msg.reason === "transferred") {
            toast.info("Wiedergabe wurde auf ein anderes Gerät übertragen.");
          }
          return;
        }
        case "command": {
          const sock = socketRef.current;
          const party = usePartyStore.getState();
          if (party.active && !party.detached && !party.isHost && !party.guestsCanControl) {
            sock?.send({
              type: "command_ack",
              command_id: msg.command_id,
              ok: false,
              error: `Dieses Gerät folgt gerade einer Jam – ${party.hostName} steuert die Wiedergabe.`,
            });
            return;
          }
          const player = usePlayerStore.getState();
          // Guard against remoteBridge re-entry (e.g. command explicitly targeted
          // to this device while it is acting as a remote controller).
          if (player.remoteBridge !== null) {
            sock?.send({
              type: "command_ack",
              command_id: msg.command_id,
              ok: false,
              error: "Dieses Gerät steuert aktuell ein anderes Gerät und kann den Befehl nicht lokal ausführen.",
            });
            return;
          }
          try {
            runWhileApplyingRemote(() => {
              executeLocalConnectCommand(
                msg.action,
                msg.payload,
                usePlayerStore.getState(),
                (repeat) => usePlayerStore.setState({ repeat }),
                (muted) => usePlayerStore.setState({ muted }),
              );
            });
            sock?.send({
              type: "command_ack",
              command_id: msg.command_id,
              ok: true,
            });
            publishPlayback(false);
          } catch (cause) {
            const detail = cause instanceof Error ? cause.message : String(cause);
            sock?.send({
              type: "command_ack",
              command_id: msg.command_id,
              ok: false,
              error: detail,
            });
            toast.error(`Remote-Befehl fehlgeschlagen: ${detail}`);
          }
          return;
        }
        case "command_result":
          if (!msg.ok && !msg.request_id) {
            toast.error(msg.error || "Remote-Befehl fehlgeschlagen.");
          }
          return;
        case "error":
          if (!msg.request_id) {
            toast.error(`Connect-Fehler (${msg.code}): ${msg.detail}`);
          }
          return;
      }
    };

    const socket = new ConnectSocket({
      buildRegister: () => {
        const connect = useConnectStore.getState();
        const player = usePlayerStore.getState();
        const party = usePartyStore.getState();
        const jamFollower = isNonHostJamFollower(party);
        const playingLocally =
          !jamFollower &&
          player.isPlaying &&
          player.index >= 0 &&
          !player.suppressLocalAudio &&
          !player.remoteBridge;
        return {
          type: "register",
          device_id: connect.deviceId,
          name: connect.deviceName,
          device_type: "web",
          capabilities: { can_play_audio: true, can_control_volume: true },
          volume: player.volume,
          muted: player.muted,
          party_code: party.active ? party.code : null,
          take_active: playingLocally,
          ...(!jamFollower && player.queue.length > 0
            ? { playback: buildConnectPlaybackSnapshot(player) }
            : {}),
        };
      },
      onMessage: handleServerMessage,
      onStatusChange: (nextStatus, err) => {
        useConnectStore.getState().setStatus(nextStatus, err);
        if (nextStatus === "error" && err) {
          toast.error(err);
        }
        if (nextStatus !== "connected") {
          const player = usePlayerStore.getState();
          if (player.remoteBridge) {
            player.setRemoteBridge(null);
            const party = usePartyStore.getState();
            if (!(party.active && !party.detached)) {
              player.setSuppressLocalAudio(false);
            }
          }
        }
      },
    });

    socketRef.current = socket;

    useConnectStore.getState().setActions({
      transferTo: async (targetDeviceId: string, play?: boolean) => {
        useConnectStore.getState().setTransferringToId(targetDeviceId);
        try {
          await socket.sendTransfer(targetDeviceId, play);
        } finally {
          useConnectStore.getState().setTransferringToId(null);
        }
      },
      renameDevice: async (name: string) => {
        useConnectStore.getState().setDeviceNameLocal(name);
        if (socket.isOpen()) {
          socket.send({ type: "update_device", name: name.trim() });
        }
      },
      sendCommand,
      reconnect: () => socket.reconnectNow(),
      syncPartyCode: (partyCode: string | null) => {
        if (socket.isOpen()) {
          socket.send({ type: "update_device", party_code: partyCode });
        }
      },
    });

    socket.start();

    // Subscribe to local player changes to claim/publish active playback state.
    const unsubscribePlayer = usePlayerStore.subscribe((state, prev) => {
      if (applyingRemoteDepthRef.current > 0) return;
      if (!socket.isOpen()) return;
      if (state.remoteBridge || state.suppressLocalAudio) return;
      if (isNonHostJamFollower(usePartyStore.getState())) return;

      const connect = useConnectStore.getState();
      const isActive = connect.activeDeviceId === connect.deviceId;
      const startedPlaying =
        state.index >= 0 &&
        ((state.isPlaying && !prev.isPlaying) ||
          (state.isPlaying && state.index !== prev.index) ||
          (state.isPlaying && state.queue !== prev.queue));

      if (!isActive && !startedPlaying) return;

      const majorChange =
        state.queue !== prev.queue ||
        state.origins !== prev.origins ||
        state.index !== prev.index ||
        state.isPlaying !== prev.isPlaying ||
        state.shuffle !== prev.shuffle ||
        state.repeat !== prev.repeat ||
        state.muted !== prev.muted ||
        (state.seekTo !== null && state.seekTo !== prev.seekTo);

      if (majorChange || (!isActive && startedPlaying)) {
        publishPlayback(!isActive && startedPlaying);
        return;
      }

      if (state.volume !== prev.volume && isActive) {
        if (volumePublishTimer.current !== null) {
          window.clearTimeout(volumePublishTimer.current);
        }
        volumePublishTimer.current = window.setTimeout(() => {
          volumePublishTimer.current = null;
          publishPlayback(false);
        }, VOLUME_DEBOUNCE_MS);
      }
    });

    return () => {
      unsubscribePlayer();
      if (volumePublishTimer.current !== null) {
        window.clearTimeout(volumePublishTimer.current);
        volumePublishTimer.current = null;
      }
      socket.dispose();
      if (socketRef.current === socket) socketRef.current = null;
      useConnectStore.getState().setActions(null);
      const player = usePlayerStore.getState();
      if (player.remoteBridge) {
        player.setRemoteBridge(null);
        const party = usePartyStore.getState();
        if (!(party.active && !party.detached)) {
          player.setSuppressLocalAudio(false);
        }
      }
    };
  }, [me?.is_approved, enabled]);

  // Periodic playhead heartbeat while THIS browser is the active Connect playback device.
  useEffect(() => {
    if (!enabled || status !== "connected" || !deviceId || activeDeviceId !== deviceId) return;
    const interval = window.setInterval(() => {
      const sock = socketRef.current;
      const player = usePlayerStore.getState();
      if (
        !sock?.isOpen() ||
        player.remoteBridge ||
        player.suppressLocalAudio ||
        !player.isPlaying ||
        isNonHostJamFollower(usePartyStore.getState())
      ) {
        return;
      }
      try {
        sock.send({
          type: "playback_state",
          state: buildConnectPlaybackSnapshot(player),
        });
      } catch {
        // Closed socket is handled by ConnectSocket.onclose.
      }
    }, HEARTBEAT_PUBLISH_MS);
    return () => window.clearInterval(interval);
  }, [enabled, status, deviceId, activeDeviceId]);

  // Smooth local playhead interpolation while controlling another device remotely.
  useEffect(() => {
    const remote =
      !partyOwnsPlayback &&
      enabled &&
      status === "connected" &&
      activeDeviceId !== null &&
      deviceId !== "" &&
      activeDeviceId !== deviceId;
    if (!remote || !playback?.is_playing) return;
    const interval = window.setInterval(() => {
      const player = usePlayerStore.getState();
      if (!player.remoteBridge) return;
      const pos = interpolatedPositionSec(playback, Date.now(), clockOffsetMs);
      player._setCurrentTime(pos);
    }, 500);
    return () => window.clearInterval(interval);
  }, [partyOwnsPlayback, enabled, status, activeDeviceId, deviceId, playback, clockOffsetMs]);

  // Re-evaluate Connect remote controller ownership if a Jam starts or ends
  // while another personal device is currently active.
  useEffect(() => {
    const connect = useConnectStore.getState();
    const player = usePlayerStore.getState();
    if (partyOwnsPlayback) {
      if (player.remoteBridge) player.setRemoteBridge(null);
      return;
    }
    if (isControllingRemoteDevice(connect) && connect.playback && !player.remoteBridge) {
      const sock = socketRef.current;
      if (!sock?.isOpen()) return;
      player.setRemoteBridge(
        createConnectRemoteBridge((action, payload) => {
          void connect.actions?.sendCommand(action, payload).catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : String(error));
          });
        }),
      );
      player.setSuppressLocalAudio(true);
      runWhileApplyingRemote(() => {
        const pos = interpolatedPositionSec(
          connect.playback as NonNullable<typeof connect.playback>,
          Date.now(),
          connect.clockOffsetMs,
        );
        player.applyRemotePlaybackState(
          connect.playback as NonNullable<typeof connect.playback>,
          pos,
        );
      });
    }
  }, [partyOwnsPlayback, enabled, status, activeDeviceId, deviceId]);

  return null;
}
