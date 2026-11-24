import { useSyncExternalStore } from 'react';
import type {
  ConnectCommandAction,
  ConnectCommandPayloadMap,
  ConnectDevice,
  ConnectPlaybackInput,
  ConnectPlaybackState,
  ConnectServerFrame,
  ConnectState,
} from '../api/types';
import { strings } from '../localization';
import { PlaybackState, type PlayerSnapshot } from '../player/playerPort';
import {
  IDLE_CONNECT_SNAPSHOT,
  localSnapshotToConnectPlayback,
  MOBILE_CONNECT_CAPABILITIES,
  validateConnectDeviceName,
  type ConnectPhase,
  type ConnectSessionSnapshot,
} from './connectModel';
import type {
  ConnectSocketCloseInfo,
  ConnectSocketHandle,
  ConnectSocketHandlers,
} from './connectSocket';
import type { ConnectDeviceIdentity } from './deviceIdentity';

export const CONNECT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;
export const CONNECT_PLAYBACK_TICK_MS = 3_000;
export const CONNECT_COMMAND_TIMEOUT_MS = 10_000;

export interface ConnectSessionPlayer {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Readonly<PlayerSnapshot>;
  isContextShuffleEnabled(): boolean;
  pause(): void;
  applyActivatedPlayback(playback: ConnectPlaybackState): Promise<void>;
  executeRemoteCommand(
    action: ConnectCommandAction,
    payload: Record<string, unknown>,
  ): Promise<void>;
}

export interface ConnectSessionDependencies {
  loadIdentity(): Promise<ConnectDeviceIdentity>;
  saveDeviceName(name: string): Promise<string>;
  saveEnabled(enabled: boolean): Promise<void>;
  openSocket(handlers: ConnectSocketHandlers): Promise<ConnectSocketHandle>;
  player: ConnectSessionPlayer;
  isOnline(): boolean;
  subscribeConnectivity(listener: () => void): () => void;
  getActivePartyState(): { code: string | null; isHost: boolean; controlOnly: boolean };
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

interface PendingRequest {
  readonly kind: 'command' | 'transfer';
  readonly targetDeviceId?: string;
  readonly timer: unknown;
  resolve(): void;
  reject(error: Error): void;
}

function playbackSignature(playback: ConnectPlaybackInput): string {
  return JSON.stringify([
    playback.current_index,
    playback.is_playing,
    playback.shuffle,
    playback.repeat,
    playback.queue_context,
    playback.queue.map((t) => t.id),
    playback.origins,
  ]);
}

function deriveSnapshot(
  base: {
    phase: ConnectPhase;
    enabled: boolean;
    selfDeviceId: string | null;
    selfDeviceName: string;
    selfDeviceType: ConnectSessionSnapshot['selfDeviceType'];
    state: ConnectState | null;
    transferringToDeviceId: string | null;
    error: string | null;
  },
): ConnectSessionSnapshot {
  const activeDevice: ConnectDevice | null =
    base.state === null || base.state.active_device_id === null
      ? null
      : base.state.devices.find((d) => d.device_id === base.state?.active_device_id) ?? null;
  const isSelfActive =
    base.selfDeviceId !== null
    && base.state !== null
    && base.state.active_device_id === base.selfDeviceId;
  const isControllingRemote =
    base.selfDeviceId !== null
    && activeDevice !== null
    && activeDevice.device_id !== base.selfDeviceId;
  return Object.freeze({
    ...base,
    activeDevice,
    isSelfActive,
    isControllingRemote,
  });
}

/**
 * App-wide personal multi-device Spotify Connect session over `/api/connect/ws`.
 * Strictly validates every frame, tracks command/transfer acks with timeouts,
 * never silently fakes unsupported capabilities (mobile volume), and pauses
 * cleanly on offline/logout.
 */
export class ConnectSession {
  private snapshot: ConnectSessionSnapshot = IDLE_CONNECT_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private started = false;
  private generation = 0;
  private identity: ConnectDeviceIdentity | null = null;
  private socket: ConnectSocketHandle | null = null;
  private partyCode: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private playbackTickTimer: unknown = null;
  private unsubscribePlayer: (() => void) | null = null;
  private unsubscribeConnectivity: (() => void) | null = null;
  private applyingRemoteDepth = 0;
  private lastPublishedSignature: string | null = null;
  private lastLocalWasPlaying = false;
  private requestCounter = 0;
  private readonly pendingRequests = new Map<string, PendingRequest>();

  constructor(private readonly deps: ConnectSessionDependencies) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ConnectSessionSnapshot => this.snapshot;

  /** Start the Connect runtime for the current approved account. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const gen = ++this.generation;
    const party = this.deps.getActivePartyState();
    this.partyCode = party.code;

    let identity: ConnectDeviceIdentity;
    try {
      identity = await this.deps.loadIdentity();
    } catch (error) {
      if (this.generation !== gen || !this.started) return;
      this.publish({
        phase: 'error',
        enabled: true,
        selfDeviceId: null,
        selfDeviceName: '',
        selfDeviceType: 'mobile',
        state: null,
        transferringToDeviceId: null,
        error: strings.connect.connectionFailed(error instanceof Error ? error.message : String(error)),
      });
      return;
    }
    if (this.generation !== gen || !this.started) return;
    this.identity = identity;
    this.unsubscribePlayer = this.deps.player.subscribe(() => this.onLocalPlayerChanged());
    this.unsubscribeConnectivity = this.deps.subscribeConnectivity(() => this.onConnectivityChanged());
    this.playbackTickTimer = this.deps.setInterval(
      () => this.onPlaybackTick(),
      CONNECT_PLAYBACK_TICK_MS,
    );

    if (!identity.enabled) {
      this.publish({
        phase: 'disabled',
        enabled: false,
        selfDeviceId: identity.deviceId,
        selfDeviceName: identity.name,
        selfDeviceType: identity.deviceType,
        state: null,
        transferringToDeviceId: null,
        error: null,
      });
      return;
    }

    if (!this.deps.isOnline()) {
      this.publish({
        phase: 'offline',
        enabled: true,
        selfDeviceId: identity.deviceId,
        selfDeviceName: identity.name,
        selfDeviceType: identity.deviceType,
        state: null,
        transferringToDeviceId: null,
        error: null,
      });
      return;
    }

    void this.connect(gen, false);
  }

  /** Stop the Connect runtime cleanly (unmount / sign-out). */
  stop(): void {
    this.started = false;
    this.generation += 1;
    this.teardownConnection('Connect session stopped');
    this.unsubscribePlayer?.();
    this.unsubscribePlayer = null;
    this.unsubscribeConnectivity?.();
    this.unsubscribeConnectivity = null;
    if (this.playbackTickTimer !== null) {
      this.deps.clearInterval(this.playbackTickTimer);
      this.playbackTickTimer = null;
    }
    this.lastPublishedSignature = null;
    this.lastLocalWasPlaying = false;
    this.publish({
      phase: 'idle',
      enabled: this.identity?.enabled ?? true,
      selfDeviceId: this.identity?.deviceId ?? null,
      selfDeviceName: this.identity?.name ?? '',
      selfDeviceType: this.identity?.deviceType ?? 'mobile',
      state: null,
      transferringToDeviceId: null,
      error: null,
    });
  }

  /** Full local reset on logout / account switch. */
  reset(): void {
    this.stop();
    this.identity = null;
    this.partyCode = null;
    this.snapshot = IDLE_CONNECT_SNAPSHOT;
    for (const listener of [...this.listeners]) listener();
  }

  retry(): void {
    if (!this.started || this.identity === null || !this.identity.enabled) return;
    if (!this.deps.isOnline()) {
      this.publish({
        ...this.currentBase(),
        phase: 'offline',
        error: null,
      });
      return;
    }
    this.reconnectAttempt = 0;
    this.teardownConnection('Reconnecting');
    void this.connect(this.generation, false);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.deps.saveEnabled(enabled);
    if (this.identity !== null) {
      this.identity = Object.freeze({ ...this.identity, enabled });
    }
    if (!enabled) {
      this.teardownConnection('Connect sync disabled');
      this.publish({
        ...this.currentBase(),
        phase: 'disabled',
        enabled: false,
        state: null,
        transferringToDeviceId: null,
        error: null,
      });
      return;
    }
    this.publish({
      ...this.currentBase(),
      enabled: true,
      error: null,
    });
    if (this.started && this.identity !== null) {
      if (!this.deps.isOnline()) {
        this.publish({ ...this.currentBase(), phase: 'offline', enabled: true, error: null });
      } else {
        this.reconnectAttempt = 0;
        void this.connect(this.generation, false);
      }
    }
  }

  async renameDevice(name: string): Promise<string> {
    const validated = validateConnectDeviceName(name);
    const saved = await this.deps.saveDeviceName(validated);
    if (this.identity !== null) {
      this.identity = Object.freeze({ ...this.identity, name: saved });
    }
    this.publish({
      ...this.currentBase(),
      selfDeviceName: saved,
    });
    if (this.socket !== null && this.snapshot.phase === 'connected') {
      this.socket.send({ type: 'update_device', name: saved });
    }
    return saved;
  }

  setPartyCode(code: string | null): void {
    if (this.partyCode === code) return;
    this.partyCode = code;
    if (this.socket !== null && this.snapshot.phase === 'connected') {
      try {
        this.socket.send({ type: 'update_device', party_code: code });
      } catch (error) {
        this.publish({
          ...this.currentBase(),
          error: strings.connect.connectionFailed(
            error instanceof Error ? error.message : String(error),
          ),
        });
      }
    }
  }

  /** Transfer active playback to `targetDeviceId` (or pull to this device). */
  async transferPlayback(targetDeviceId: string, play?: boolean): Promise<void> {
    const socket = this.requireConnectedSocket();
    const requestId = this.nextRequestId('transfer');
    this.publish({
      ...this.currentBase(),
      transferringToDeviceId: targetDeviceId,
      error: null,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = this.deps.setTimeout(() => {
          this.pendingRequests.delete(requestId);
          reject(new Error('Playback transfer timed out'));
        }, CONNECT_COMMAND_TIMEOUT_MS);
        this.pendingRequests.set(requestId, {
          kind: 'transfer',
          targetDeviceId,
          timer,
          resolve,
          reject,
        });
        try {
          socket.send({
            type: 'transfer',
            target_device_id: targetDeviceId,
            ...(play === undefined ? {} : { play }),
            request_id: requestId,
          });
        } catch (error) {
          this.deps.clearTimeout(timer);
          this.pendingRequests.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } finally {
      if (this.snapshot.transferringToDeviceId === targetDeviceId) {
        this.publish({
          ...this.currentBase(),
          transferringToDeviceId: null,
        });
      }
    }
  }

  /** Send a remote playback command to the active device (or an explicit target device). */
  async sendCommand<A extends ConnectCommandAction>(
    action: A,
    payload: ConnectCommandPayloadMap[A],
    targetDeviceId?: string,
  ): Promise<void> {
    const socket = this.requireConnectedSocket();
    if (this.snapshot.error !== null) {
      this.publish({ ...this.currentBase(), error: null });
    }
    const requestId = this.nextRequestId('cmd');
    await new Promise<void>((resolve, reject) => {
      const timer = this.deps.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Remote command "${action}" timed out`));
      }, CONNECT_COMMAND_TIMEOUT_MS);
      this.pendingRequests.set(requestId, {
        kind: 'command',
        timer,
        resolve,
        reject,
      });
      try {
        socket.send({
          type: 'command',
          request_id: requestId,
          ...(targetDeviceId === undefined ? {} : { target_device_id: targetDeviceId }),
          action,
          payload: payload as Record<string, unknown>,
        });
      } catch (error) {
        this.deps.clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private requireConnectedSocket(): ConnectSocketHandle {
    if (this.socket === null || this.snapshot.phase !== 'connected') {
      throw new Error(strings.connect.disconnected);
    }
    return this.socket;
  }

  private nextRequestId(prefix: string): string {
    this.requestCounter += 1;
    return `${prefix}-${this.requestCounter}`;
  }

  private currentBase() {
    return {
      phase: this.snapshot.phase,
      enabled: this.snapshot.enabled,
      selfDeviceId: this.snapshot.selfDeviceId,
      selfDeviceName: this.snapshot.selfDeviceName,
      selfDeviceType: this.snapshot.selfDeviceType,
      state: this.snapshot.state,
      transferringToDeviceId: this.snapshot.transferringToDeviceId,
      error: this.snapshot.error,
    };
  }

  private publish(next: {
    phase: ConnectPhase;
    enabled: boolean;
    selfDeviceId: string | null;
    selfDeviceName: string;
    selfDeviceType: ConnectSessionSnapshot['selfDeviceType'];
    state: ConnectState | null;
    transferringToDeviceId: string | null;
    error: string | null;
  }): void {
    this.snapshot = deriveSnapshot(next);
    for (const listener of [...this.listeners]) listener();
  }

  private teardownConnection(rejectReason: string): void {
    this.socket?.close();
    this.socket = null;
    if (this.reconnectTimer !== null) {
      this.deps.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      this.deps.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const [id, pending] of this.pendingRequests) {
      this.deps.clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.reject(new Error(rejectReason));
    }
  }

  private async connect(gen: number, reconnecting: boolean): Promise<void> {
    if (!this.started || this.generation !== gen || this.identity === null || !this.identity.enabled) {
      return;
    }
    const identity = this.identity;
    this.publish({
      ...this.currentBase(),
      phase: reconnecting ? 'reconnecting' : 'connecting',
      selfDeviceId: identity.deviceId,
      selfDeviceName: identity.name,
      selfDeviceType: identity.deviceType,
      error: reconnecting ? this.snapshot.error : null,
    });

    let handle: ConnectSocketHandle;
    try {
      handle = await this.deps.openSocket({
        onOpen: () => {
          if (this.generation !== gen || this.socket !== handle) return;
          this.sendRegister(handle, identity);
        },
        onFrame: (frame) => {
          if (this.generation !== gen || this.socket !== handle) return;
          this.onServerFrame(handle, frame);
        },
        onProtocolError: (error) => {
          if (this.generation !== gen || this.socket !== handle) return;
          this.handleDisconnect(gen, error.message, false, false);
        },
        onClosed: (info: ConnectSocketCloseInfo) => {
          if (this.generation !== gen || this.socket !== handle) return;
          this.handleDisconnect(gen, info.reason, info.authFailed, info.replaced);
        },
      });
    } catch (error) {
      if (this.generation !== gen || !this.started) return;
      const detail = error instanceof Error ? error.message : String(error);
      this.handleDisconnect(gen, detail, false, false);
      return;
    }
    if (this.generation !== gen || !this.started) {
      handle.close();
      return;
    }
    this.socket = handle;
  }

  private sendRegister(handle: ConnectSocketHandle, identity: ConnectDeviceIdentity): void {
    const localSnapshot = this.deps.player.getSnapshot();
    const party = this.deps.getActivePartyState();
    const isNonHostPartyFollower = party.code !== null && !party.isHost;
    const localHasPlaying =
      !isNonHostPartyFollower
      && localSnapshot.activeIndex !== null
      && (localSnapshot.isPlaying || localSnapshot.playbackState === PlaybackState.Buffering);
    let playback: ConnectPlaybackInput | undefined;
    if (!isNonHostPartyFollower && localSnapshot.queue.length > 0) {
      try {
        playback = localSnapshotToConnectPlayback(
          localSnapshot,
          this.deps.player.isContextShuffleEnabled(),
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.teardownConnection(detail);
        this.publish({
          ...this.currentBase(),
          phase: 'error',
          transferringToDeviceId: null,
          error: strings.connect.connectionFailed(detail),
        });
        return;
      }
    }
    handle.send({
      type: 'register',
      device_id: identity.deviceId,
      name: identity.name,
      device_type: identity.deviceType,
      capabilities: { ...MOBILE_CONNECT_CAPABILITIES },
      volume: 1,
      muted: false,
      party_code: this.partyCode,
      take_active: localHasPlaying,
      ...(playback === undefined ? {} : { playback }),
    });
  }

  private handleDisconnect(
    gen: number,
    reason: string,
    authFailed: boolean,
    replaced: boolean,
  ): void {
    this.teardownConnection(reason);
    if (!this.started || this.generation !== gen) return;
    if (this.identity !== null && !this.identity.enabled) return;

    if (!this.deps.isOnline()) {
      this.publish({
        ...this.currentBase(),
        phase: 'offline',
        transferringToDeviceId: null,
        error: null,
      });
      return;
    }

    if (authFailed || replaced) {
      this.publish({
        ...this.currentBase(),
        phase: 'error',
        transferringToDeviceId: null,
        error: strings.connect.connectionFailed(reason),
      });
      return;
    }

    this.publish({
      ...this.currentBase(),
      phase: 'reconnecting',
      transferringToDeviceId: null,
      error: strings.connect.connectionFailed(reason),
    });

    const delay =
      CONNECT_RECONNECT_DELAYS_MS[
        Math.min(this.reconnectAttempt, CONNECT_RECONNECT_DELAYS_MS.length - 1)
      ];
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.deps.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.started && this.generation === gen && this.deps.isOnline()) {
        void this.connect(gen, true);
      }
    }, delay);
  }

  private onConnectivityChanged(): void {
    if (!this.started || this.identity === null || !this.identity.enabled) return;
    if (!this.deps.isOnline()) {
      this.teardownConnection('Offline');
      this.publish({
        ...this.currentBase(),
        phase: 'offline',
        transferringToDeviceId: null,
        error: null,
      });
      return;
    }
    if (this.snapshot.phase === 'offline' || this.snapshot.phase === 'reconnecting') {
      this.reconnectAttempt = 0;
      this.teardownConnection('Reconnecting');
      void this.connect(this.generation, false);
    }
  }

  private onServerFrame(handle: ConnectSocketHandle, frame: ConnectServerFrame): void {
    switch (frame.type) {
      case 'welcome': {
        this.reconnectAttempt = 0;
        if (this.heartbeatTimer !== null) this.deps.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = this.deps.setInterval(() => {
          if (this.socket === handle && this.snapshot.phase === 'connected') {
            try {
              handle.send({ type: 'ping' });
            } catch (error) {
              this.publish({
                ...this.currentBase(),
                error: strings.connect.connectionFailed(
                  error instanceof Error ? error.message : String(error),
                ),
              });
            }
          }
        }, frame.heartbeat_interval_sec * 1000);
        this.lastPublishedSignature = null;
        this.publish({
          ...this.currentBase(),
          phase: 'connected',
          selfDeviceId: frame.self_device_id,
          state: frame.state,
          error: null,
        });
        this.resolveMatchingTransfers(frame.state);
        return;
      }
      case 'state': {
        this.publish({
          ...this.currentBase(),
          phase: 'connected',
          state: frame.state,
        });
        this.resolveMatchingTransfers(frame.state);
        return;
      }
      case 'ping': {
        try {
          handle.send({ type: 'pong' });
        } catch (error) {
          this.publish({
            ...this.currentBase(),
            error: strings.connect.connectionFailed(
              error instanceof Error ? error.message : String(error),
            ),
          });
        }
        return;
      }
      case 'pong':
        return;
      case 'activate': {
        void this.handleActivate(frame.playback);
        return;
      }
      case 'deactivated': {
        this.applyingRemoteDepth += 1;
        try {
          this.deps.player.pause();
          this.lastLocalWasPlaying = false;
        } finally {
          this.applyingRemoteDepth -= 1;
        }
        return;
      }
      case 'command': {
        void this.handleIncomingCommand(handle, frame.command_id, frame.action, frame.payload);
        return;
      }
      case 'command_result': {
        if (frame.request_id !== null) {
          const pending = this.pendingRequests.get(frame.request_id);
          if (pending !== undefined) {
            this.deps.clearTimeout(pending.timer);
            this.pendingRequests.delete(frame.request_id);
            if (frame.ok) pending.resolve();
            else pending.reject(new Error(frame.error ?? 'Remote command failed'));
            return;
          }
        }
        if (!frame.ok) {
          this.publish({
            ...this.currentBase(),
            error: strings.connect.commandFailed(frame.error ?? 'Unknown error'),
          });
        }
        return;
      }
      case 'error': {
        const message = `${frame.code}: ${frame.detail}`;
        if (frame.request_id !== null) {
          const pending = this.pendingRequests.get(frame.request_id);
          if (pending !== undefined) {
            this.deps.clearTimeout(pending.timer);
            this.pendingRequests.delete(frame.request_id);
            pending.reject(new Error(message));
            return;
          }
        }
        this.publish({
          ...this.currentBase(),
          error: strings.connect.commandFailed(message),
        });
      }
    }
  }

  private resolveMatchingTransfers(state: ConnectState): void {
    for (const [id, pending] of this.pendingRequests) {
      if (pending.kind === 'transfer' && state.active_device_id === pending.targetDeviceId) {
        this.deps.clearTimeout(pending.timer);
        this.pendingRequests.delete(id);
        pending.resolve();
      }
    }
  }

  private async handleActivate(playback: ConnectPlaybackState): Promise<void> {
    this.applyingRemoteDepth += 1;
    try {
      await this.deps.player.applyActivatedPlayback(playback);
      this.lastLocalWasPlaying = playback.is_playing;
      this.lastPublishedSignature = null;
      if (this.snapshot.isSelfActive) {
        this.publishLocalPlaybackState(false, true);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.publish({
        ...this.currentBase(),
        error: strings.connect.transferFailed(detail),
      });
    } finally {
      this.applyingRemoteDepth -= 1;
    }
  }

  private async handleIncomingCommand(
    handle: ConnectSocketHandle,
    commandId: string,
    action: ConnectCommandAction,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sendAck = (ok: boolean, error?: string) => {
      if (this.socket !== handle) return;
      try {
        handle.send({
          type: 'command_ack',
          command_id: commandId,
          ok,
          ...(error === undefined ? {} : { error }),
        });
      } catch (sendError) {
        this.publish({
          ...this.currentBase(),
          error: strings.connect.connectionFailed(
            sendError instanceof Error ? sendError.message : String(sendError),
          ),
        });
      }
    };

    if (action === 'set_volume' || action === 'set_mute') {
      sendAck(false, strings.connect.volumeUnsupported);
      return;
    }

    const party = this.deps.getActivePartyState();
    if (party.code !== null && !party.isHost && !party.controlOnly) {
      sendAck(false, 'This device is following a Jam session');
      return;
    }

    this.applyingRemoteDepth += 1;
    try {
      await this.deps.player.executeRemoteCommand(action, payload);
      sendAck(true);
      this.lastPublishedSignature = null;
      this.publishLocalPlaybackState(false, true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sendAck(false, detail);
    } finally {
      this.applyingRemoteDepth -= 1;
    }
  }

  private onLocalPlayerChanged(): void {
    if (this.applyingRemoteDepth > 0 || this.socket === null || this.snapshot.phase !== 'connected') {
      return;
    }
    const snap = this.deps.player.getSnapshot();
    const isNowPlaying =
      snap.activeIndex !== null
      && (snap.isPlaying || snap.playbackState === PlaybackState.Buffering);
    const startedLocally = isNowPlaying && !this.lastLocalWasPlaying;
    this.lastLocalWasPlaying = isNowPlaying;

    const party = this.deps.getActivePartyState();
    if (party.code !== null && !party.isHost) {
      // Non-host party followers do not claim personal Connect active device on party sync.
      return;
    }

    if (this.snapshot.isSelfActive) {
      this.publishLocalPlaybackState(false, false);
    } else if (startedLocally) {
      this.publishLocalPlaybackState(true, true);
    }
  }

  private onPlaybackTick(): void {
    if (
      this.applyingRemoteDepth > 0
      || this.socket === null
      || this.snapshot.phase !== 'connected'
      || !this.snapshot.isSelfActive
    ) {
      return;
    }
    const snap = this.deps.player.getSnapshot();
    const playing =
      snap.activeIndex !== null
      && (snap.isPlaying || snap.playbackState === PlaybackState.Buffering);
    if (!playing) return;
    this.publishLocalPlaybackState(false, true);
  }

  private publishLocalPlaybackState(claimActive: boolean, force: boolean): void {
    if (this.socket === null || this.snapshot.phase !== 'connected') return;
    let playback: ConnectPlaybackInput;
    try {
      playback = localSnapshotToConnectPlayback(
        this.deps.player.getSnapshot(),
        this.deps.player.isContextShuffleEnabled(),
      );
    } catch (error) {
      this.publish({
        ...this.currentBase(),
        error: strings.connect.commandFailed(
          error instanceof Error ? error.message : String(error),
        ),
      });
      return;
    }
    const sig = playbackSignature(playback);
    if (!force && !claimActive && sig === this.lastPublishedSignature) return;
    this.lastPublishedSignature = sig;
    try {
      this.socket.send({
        type: 'playback_state',
        ...(claimActive ? { claim_active: true } : {}),
        state: playback,
      });
    } catch (error) {
      this.publish({
        ...this.currentBase(),
        error: strings.connect.connectionFailed(
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
  }
}

export function useConnectSessionSnapshot(session: ConnectSession): ConnectSessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
