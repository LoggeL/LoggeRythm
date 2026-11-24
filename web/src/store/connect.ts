import { create } from "zustand";
import type {
  ConnectCommandAction,
  ConnectDevice,
  ConnectPlaybackState,
  ConnectState,
} from "@/types";
import {
  CONNECT_DEVICE_ID_KEY,
  CONNECT_DEVICE_NAME_KEY,
  CONNECT_ENABLED_KEY,
  detectBrowserDeviceName,
} from "@/lib/connectProtocol";

export type ConnectConnectionStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface ConnectControllerActions {
  transferTo: (targetDeviceId: string, play?: boolean) => Promise<void>;
  renameDevice: (name: string) => Promise<void>;
  sendCommand: (
    action: ConnectCommandAction,
    payload?: Record<string, unknown>,
    targetDeviceId?: string | null,
  ) => Promise<void>;
  reconnect: () => void;
  syncPartyCode: (partyCode: string | null) => void;
}

export interface ConnectStoreState {
  enabled: boolean;
  deviceId: string;
  deviceName: string;
  status: ConnectConnectionStatus;
  error: string | null;
  revision: number;
  activeDeviceId: string | null;
  devices: ConnectDevice[];
  playback: ConnectPlaybackState | null;
  clockOffsetMs: number;
  transferringToId: string | null;
  selectorOpen: boolean;
  /** Element that opened the single DeviceSelectorHost popover, if any. */
  selectorAnchor: HTMLElement | null;
  actions: ConnectControllerActions | null;

  hydrateIdentity: () => void;
  setEnabled: (enabled: boolean) => void;
  setDeviceNameLocal: (name: string) => void;
  setStatus: (status: ConnectConnectionStatus, error?: string | null) => void;
  applyServerState: (state: ConnectState, selfDeviceId?: string) => void;
  setTransferringToId: (deviceId: string | null) => void;
  setSelectorOpen: (open: boolean, anchor?: HTMLElement | null) => void;
  toggleSelector: (anchor?: HTMLElement | null) => void;
  setActions: (actions: ConnectControllerActions | null) => void;
  resetSession: () => void;
}

function readStoredEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(CONNECT_ENABLED_KEY);
  if (raw === null) return true;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Lokale Daten "${CONNECT_ENABLED_KEY}": "true" oder "false" wurde erwartet, gefunden: ${JSON.stringify(raw)}.`);
}

function readOrCreateTabDeviceId(): string {
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem(CONNECT_DEVICE_ID_KEY);
  if (existing && existing.trim() !== "") return existing;
  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `web-${crypto.randomUUID()}`
      : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(CONNECT_DEVICE_ID_KEY, generated);
  return generated;
}

function readOrDetectDeviceName(): string {
  if (typeof window === "undefined") return "Webplayer";
  const stored = window.localStorage.getItem(CONNECT_DEVICE_NAME_KEY);
  if (stored && stored.trim() !== "") return stored.trim();
  return detectBrowserDeviceName();
}

export const useConnectStore = create<ConnectStoreState>((set, get) => ({
  enabled: true,
  deviceId: "",
  deviceName: "Webplayer",
  status: "disabled",
  error: null,
  revision: 0,
  activeDeviceId: null,
  devices: [],
  playback: null,
  clockOffsetMs: 0,
  transferringToId: null,
  selectorOpen: false,
  selectorAnchor: null,
  actions: null,

  hydrateIdentity: () => {
    const enabled = readStoredEnabled();
    const deviceId = readOrCreateTabDeviceId();
    const deviceName = readOrDetectDeviceName();
    set({
      enabled,
      deviceId,
      deviceName,
      status: enabled ? get().status : "disabled",
    });
  },

  setEnabled: (enabled) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CONNECT_ENABLED_KEY, enabled ? "true" : "false");
    }
    set({
      enabled,
      ...(enabled
        ? { error: null }
        : {
            status: "disabled",
            error: null,
            activeDeviceId: null,
            devices: [],
            playback: null,
            transferringToId: null,
          }),
    });
  },

  setDeviceNameLocal: (name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Gerätename darf nicht leer sein.");
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CONNECT_DEVICE_NAME_KEY, trimmed);
    }
    set({ deviceName: trimmed });
  },

  setStatus: (status, error = null) => set({ status, error }),

  applyServerState: (serverState, selfDeviceId) => {
    let clockOffsetMs = get().clockOffsetMs;
    if (serverState.server_time) {
      const serverMs = Date.parse(serverState.server_time);
      if (Number.isFinite(serverMs)) {
        clockOffsetMs = serverMs - Date.now();
      }
    }
    set((s) => ({
      ...(selfDeviceId ? { deviceId: selfDeviceId } : {}),
      revision: serverState.revision,
      activeDeviceId: serverState.active_device_id,
      devices: serverState.devices,
      playback: serverState.playback,
      clockOffsetMs,
      transferringToId:
        s.transferringToId && serverState.active_device_id === s.transferringToId
          ? null
          : s.transferringToId,
    }));
  },

  setTransferringToId: (transferringToId) => set({ transferringToId }),
  setSelectorOpen: (selectorOpen, anchor) =>
    set({ selectorOpen, selectorAnchor: selectorOpen ? (anchor ?? null) : null }),
  toggleSelector: (anchor) =>
    set((s) => ({
      selectorOpen: !s.selectorOpen,
      selectorAnchor: !s.selectorOpen ? (anchor ?? null) : null,
    })),
  setActions: (actions) => set({ actions }),

  resetSession: () =>
    set({
      status: "disabled",
      error: null,
      revision: 0,
      activeDeviceId: null,
      devices: [],
      playback: null,
      transferringToId: null,
      selectorOpen: false,
      selectorAnchor: null,
      actions: null,
    }),
}));

/** True when Connect is active and ANOTHER device currently owns audio playback. */
export function isControllingRemoteDevice(
  state: Pick<ConnectStoreState, "enabled" | "status" | "activeDeviceId" | "deviceId">,
): boolean {
  return (
    state.enabled &&
    state.status === "connected" &&
    state.activeDeviceId !== null &&
    state.deviceId !== "" &&
    state.activeDeviceId !== state.deviceId
  );
}

/** The active remote device being controlled, or null if playback is local/idle. */
export function activeRemoteDevice(
  state: Pick<ConnectStoreState, "enabled" | "status" | "activeDeviceId" | "deviceId" | "devices">,
): ConnectDevice | null {
  if (!isControllingRemoteDevice(state)) return null;
  return state.devices.find((device) => device.device_id === state.activeDeviceId) ?? null;
}

/** Whether the active remote device supports remote volume control (true when local). */
export function canControlActiveVolume(
  state: Pick<ConnectStoreState, "enabled" | "status" | "activeDeviceId" | "deviceId" | "devices">,
): boolean {
  const remote = activeRemoteDevice(state);
  if (!remote) return true;
  return remote.capabilities.can_control_volume;
}

/**
 * Locked PlayerBar visibility rule (#8):
 * Show the Spotify-like device selector in the compact player bar ONLY when:
 * - more than 1 device is connected, OR
 * - controlling a remote device, OR
 * - an active Jam/Party is running.
 */
export function shouldShowPlayerBarDeviceSelector(
  connect: Pick<ConnectStoreState, "enabled" | "status" | "activeDeviceId" | "deviceId" | "devices">,
  partyActive: boolean,
): boolean {
  if (partyActive) return true;
  if (!connect.enabled) return false;
  if (connect.devices.length > 1) return true;
  return isControllingRemoteDevice(connect);
}
