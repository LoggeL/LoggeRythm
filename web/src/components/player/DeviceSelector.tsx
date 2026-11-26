"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { exitPartySession } from "@/lib/partyExit";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import ConfirmDialog from "@/components/ConfirmDialog";
import EqualizerBars from "@/components/EqualizerBars";
import {
  CheckIcon,
  CloseIcon,
  DevicesIcon,
  EditIcon,
  LaptopIcon,
  PhoneIcon,
  RefreshIcon,
  SpeakerIcon,
  SpinnerIcon,
  TabletIcon,
  TvIcon,
  UsersIcon,
} from "@/components/icons";
import {
  activeRemoteDevice,
  isControllingRemoteDevice,
  shouldShowPlayerBarDeviceSelector,
  useConnectStore,
} from "@/store/connect";
import { usePartyStore } from "@/store/party";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import type { ConnectDevice, DeviceType } from "@/types";

export function DeviceTypeIcon({
  type,
  width = 18,
  height = 18,
  className = "",
}: {
  type: DeviceType;
  width?: number;
  height?: number;
  className?: string;
}) {
  switch (type) {
    case "mobile":
      return <PhoneIcon width={width} height={height} className={className} aria-hidden="true" />;
    case "tablet":
      return <TabletIcon width={width} height={height} className={className} aria-hidden="true" />;
    case "tv":
      return <TvIcon width={width} height={height} className={className} aria-hidden="true" />;
    case "speaker":
      return <SpeakerIcon width={width} height={height} className={className} aria-hidden="true" />;
    case "web":
    case "desktop":
      return <LaptopIcon width={width} height={height} className={className} aria-hidden="true" />;
    default:
      return <DevicesIcon width={width} height={height} className={className} aria-hidden="true" />;
  }
}

function deviceTypeLabel(type: DeviceType): string {
  switch (type) {
    case "web":
      return "Webplayer";
    case "mobile":
      return "Smartphone";
    case "tablet":
      return "Tablet";
    case "desktop":
      return "Desktop";
    case "tv":
      return "TV";
    case "speaker":
      return "Lautsprecher";
    default:
      return "Gerät";
  }
}

/**
 * Spotify-like device selector trigger button for PlayerBar & NowPlaying.
 * Pure button: the popover itself is rendered ONCE globally by
 * `<DeviceSelectorHost />` so responsive triggers (DesktopBar + MiniPlayer +
 * NowPlaying) never portal duplicate dialogs into `document.body`.
 */
export function DeviceSelectorTrigger({
  forceVisible = false,
  compact = false,
  className = "",
}: {
  forceVisible?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const enabled = useConnectStore((s) => s.enabled);
  const status = useConnectStore((s) => s.status);
  const activeDeviceId = useConnectStore((s) => s.activeDeviceId);
  const deviceId = useConnectStore((s) => s.deviceId);
  const devices = useConnectStore((s) => s.devices);
  const selectorOpen = useConnectStore((s) => s.selectorOpen);
  const setSelectorOpen = useConnectStore((s) => s.setSelectorOpen);
  const partyActive = usePartyStore((s) => s.active);

  const buttonRef = useRef<HTMLButtonElement>(null);

  const connectSlice = { enabled, status, activeDeviceId, deviceId, devices };
  const visible = forceVisible || shouldShowPlayerBarDeviceSelector(connectSlice, partyActive);
  const remote = activeRemoteDevice(connectSlice);
  const highlighted = Boolean(remote || partyActive || selectorOpen);

  if (!visible) return null;

  const label = remote
    ? `Geräte & Connect – Wiedergabe auf ${remote.name}`
    : partyActive
      ? "Geräte & aktive Jam"
      : `Geräte & Connect (${devices.length} verbunden)`;

  const handleToggle = () => {
    setSelectorOpen(!selectorOpen, buttonRef.current);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleToggle}
      data-testid="device-selector-trigger"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={selectorOpen}
      aria-pressed={highlighted}
      title={label}
      className={`action-icon relative ${compact ? "h-10 w-10" : "h-9 w-9"} ${
        highlighted ? "text-accent" : ""
      } ${className}`}
    >
      {partyActive && devices.length <= 1 ? (
        <UsersIcon width={18} height={18} />
      ) : (
        <DevicesIcon width={18} height={18} />
      )}
      {devices.length > 1 && !compact && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[9.5px] font-bold leading-none text-on-accent"
        >
          {devices.length}
        </span>
      )}
      {highlighted && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent-soft"
        />
      )}
    </button>
  );
}

/**
 * Single workspace-level host for the DeviceSelector popover. Guarantees at
 * most one `role="dialog"` `device-selector-popover` exists in `document.body`
 * regardless of how many triggers are mounted across responsive chrome.
 */
export function DeviceSelectorHost() {
  const selectorOpen = useConnectStore((s) => s.selectorOpen);
  const selectorAnchor = useConnectStore((s) => s.selectorAnchor);
  const setSelectorOpen = useConnectStore((s) => s.setSelectorOpen);

  if (!selectorOpen) return null;
  return (
    <DeviceSelectorPopover
      anchorElement={selectorAnchor}
      onClose={() => setSelectorOpen(false)}
    />
  );
}

function DeviceSelectorPopover({
  anchorElement,
  onClose,
}: {
  anchorElement: HTMLElement | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const enabled = useConnectStore((s) => s.enabled);
  const status = useConnectStore((s) => s.status);
  const error = useConnectStore((s) => s.error);
  const deviceId = useConnectStore((s) => s.deviceId);
  const deviceName = useConnectStore((s) => s.deviceName);
  const activeDeviceId = useConnectStore((s) => s.activeDeviceId);
  const devices = useConnectStore((s) => s.devices);
  const playback = useConnectStore((s) => s.playback);
  const transferringToId = useConnectStore((s) => s.transferringToId);
  const actions = useConnectStore((s) => s.actions);
  const setEnabled = useConnectStore((s) => s.setEnabled);

  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const partyActive = usePartyStore((s) => s.active);
  const partyCode = usePartyStore((s) => s.code);
  const partyName = usePartyStore((s) => s.name);
  const partyIsHost = usePartyStore((s) => s.isHost);
  const partyMembersCount = usePartyStore((s) => s.members.length);

  const panelRef = useRef<HTMLDivElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(deviceName);
  const [joinCode, setJoinCode] = useState("");
  const [startingJam, setStartingJam] = useState(false);
  const [leavingJam, setLeavingJam] = useState(false);
  const [pendingJamTransfer, setPendingJamTransfer] = useState<ConnectDevice | null>(null);
  const [leavingForTransfer, setLeavingForTransfer] = useState(false);

  useDialogFocus(true, panelRef, onClose);

  // Measure and anchor above the opening trigger on wide viewports (re-aligns on resize).
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const position = () => {
      if (window.innerWidth < 640) {
        el.style.left = "";
        el.style.top = "";
        return;
      }
      const { width, height } = el.getBoundingClientRect();
      const pad = 12;
      const rect =
        anchorElement && anchorElement.isConnected
          ? anchorElement.getBoundingClientRect()
          : null;
      const hasVisibleAnchor = Boolean(rect && (rect.width > 0 || rect.height > 0));
      const left = hasVisibleAnchor && rect
        ? Math.max(pad, Math.min(rect.right - width, window.innerWidth - width - pad))
        : Math.max(pad, window.innerWidth - width - pad);
      const preferredTop =
        hasVisibleAnchor && rect
          ? rect.top - height - 10
          : window.innerHeight - height - 96;
      const top =
        preferredTop >= pad
          ? preferredTop
          : hasVisibleAnchor && rect
            ? Math.max(pad, Math.min(rect.bottom + 8, window.innerHeight - height - pad))
            : pad;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [anchorElement, devices.length, error, editingName, partyActive]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorElement?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [onClose, anchorElement]);

  if (typeof document === "undefined") return null;

  const selfDevice = devices.find((d) => d.device_id === deviceId) ?? null;
  const activeDevice =
    devices.find((d) => d.device_id === activeDeviceId) ?? selfDevice;
  const otherDevices = devices.filter((d) => d.device_id !== activeDevice?.device_id);
  const controllingRemote = isControllingRemoteDevice({
    enabled,
    status,
    activeDeviceId,
    deviceId,
  });

  const executeTransfer = async (target: ConnectDevice) => {
    if (!actions) {
      toast.error("Connect ist nicht verbunden.");
      return;
    }
    try {
      await actions.transferTo(target.device_id);
      toast.success(`Wiedergabe auf „${target.name}“ übertragen.`);
    } catch (cause) {
      toast.error(
        `Gerätewechsel fehlgeschlagen: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };

  const handleSelectDevice = (target: ConnectDevice) => {
    if (target.device_id === activeDeviceId) return;
    if (!target.capabilities.can_play_audio) {
      toast.error(`„${target.name}“ unterstützt keine Audio-Wiedergabe.`);
      return;
    }
    if (partyActive && target.device_id !== deviceId) {
      setPendingJamTransfer(target);
      return;
    }
    void executeTransfer(target);
  };

  const confirmLeaveJamAndTransfer = async () => {
    const target = pendingJamTransfer;
    if (!target || !partyCode) return;
    setLeavingForTransfer(true);
    try {
      await exitPartySession(partyCode, partyIsHost ? "end" : "leave", { queryClient });
      setPendingJamTransfer(null);
      await executeTransfer(target);
    } catch (cause) {
      toast.error(
        `Jam konnte vor dem Gerätewechsel nicht verlassen werden: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    } finally {
      setLeavingForTransfer(false);
    }
  };

  const handleLeaveJam = async () => {
    if (!partyCode || leavingJam) return;
    setLeavingJam(true);
    try {
      await exitPartySession(partyCode, "leave", { queryClient });
      onClose();
    } catch (cause) {
      toast.error(
        `Jam konnte nicht verlassen werden: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setLeavingJam(false);
    }
  };

  const handleRename = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draftName.trim();
    if (!trimmed) return;
    try {
      if (actions) await actions.renameDevice(trimmed);
      else useConnectStore.getState().setDeviceNameLocal(trimmed);
      setEditingName(false);
      toast.success("Gerätename gespeichert.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleStartJam = async () => {
    setStartingJam(true);
    try {
      const party = await api.createParty(undefined, usePlayerStore.getState().partyStartSnapshot());
      try {
        usePlayerStore.getState().adoptPartyQueue(
          party.tracks.map((entry) => entry.deezer_id),
          party.tracks.map((entry) => entry.id),
        );
      } finally {
        usePartyStore.getState().setActiveCode(party.code);
        usePartyStore.getState().applyPartyState(party);
        onClose();
        router.push(`/party/${party.code}`);
      }
    } catch (cause) {
      toast.error(`Jam konnte nicht gestartet werden: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setStartingJam(false);
    }
  };

  const handleJoinJam = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = joinCode.trim().toUpperCase();
    if (!cleaned) return;
    onClose();
    router.push(`/party/${encodeURIComponent(cleaned)}`);
  };

  return createPortal(
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[125] bg-black/50 sm:hidden"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Geräte & Connect"
        data-testid="device-selector-popover"
        className="pop-in scroll-area fixed inset-x-0 bottom-0 z-[130] flex max-h-[82dvh] flex-col overflow-y-auto rounded-t-[var(--radius-panel)] border border-hairline bg-panel p-4 shadow-[0_24px_60px_rgb(0_0_0/0.65)] sm:inset-auto sm:w-[22.5rem] sm:rounded-[var(--radius-panel)]"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-extrabold tracking-tight text-foreground">
              Mit Gerät verbinden
            </h2>
            <p className="label-mono mt-0.5 text-[10px]">
              {status === "connected"
                ? `${devices.length} ${devices.length === 1 ? "Gerät" : "Geräte"} online`
                : status === "connecting"
                  ? "Verbindet…"
                  : status === "reconnecting"
                    ? "Verbindung wird wiederhergestellt…"
                    : status === "disabled"
                      ? "Connect deaktiviert"
                      : "Verbindungsfehler"}
            </p>
          </div>
          <button
            data-dialog-autofocus
            type="button"
            onClick={onClose}
            aria-label="Geräteauswahl schließen"
            className="action-icon h-9 w-9"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        {(status === "error" || status === "reconnecting") && error && (
          <div role="alert" className="error-panel mb-3 space-y-2 p-3 text-xs">
            <p>{error}</p>
            {actions && (
              <button
                type="button"
                onClick={actions.reconnect}
                className="action-secondary min-h-8 gap-1.5 px-3 text-xs"
              >
                <RefreshIcon width={14} height={14} />
                Erneut verbinden
              </button>
            )}
          </div>
        )}

        {/* Active device card */}
        {enabled && activeDevice && (
          <div className="mb-3 rounded-[var(--radius-card)] border border-accent/30 bg-[color-mix(in_srgb,var(--accent)_10%,var(--background))] p-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                <DeviceTypeIcon type={activeDevice.device_type} width={20} height={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="label-mono flex items-center gap-1.5 text-[10px] text-accent">
                  <EqualizerBars height={10} isPlaying={isPlaying} />
                  <span>{activeDevice.device_id === deviceId ? "Aktuelles Gerät" : "Wiedergabe auf"}</span>
                </p>
                <p className="mt-0.5 truncate text-sm font-bold text-foreground">
                  {activeDevice.name}
                </p>
                <p className="text-[11px] text-muted">
                  {deviceTypeLabel(activeDevice.device_type)}
                  {activeDevice.party_code ? ` · Jam ${activeDevice.party_code}` : ""}
                </p>
              </div>
              {activeDevice.device_id === deviceId && (
                <CheckIcon width={18} height={18} className="shrink-0 text-accent" aria-hidden="true" />
              )}
            </div>
            {controllingRemote && !activeDevice.capabilities.can_control_volume && (
              <p className="mt-2 border-t border-hairline pt-2 text-[11px] text-muted">
                Lautstärke wird direkt am Zielgerät geregelt.
              </p>
            )}
          </div>
        )}

        {/* Async Connect continuity: resume server-persisted session when no device is currently active */}
        {enabled &&
          activeDeviceId === null &&
          playback &&
          playback.queue.length > 0 &&
          playback.current_index >= 0 &&
          playback.current_index < playback.queue.length && (
            <div className="mb-4 rounded-[var(--radius-card)] border border-accent/35 bg-accent/10 p-3">
              <p className="label-mono text-[10px] text-accent">Letzte Sitzung verfügbar</p>
              <p className="mt-1 truncate text-sm font-semibold text-foreground">
                {playback.queue[playback.current_index].title}
              </p>
              <p className="truncate text-xs text-muted">
                {playback.queue[playback.current_index].artist} · {playback.queue.length}{" "}
                {playback.queue.length === 1 ? "Titel" : "Titel"}
              </p>
              <button
                type="button"
                onClick={() => {
                  usePlayerStore.getState().activateConnectPlayback({ ...playback, is_playing: true });
                  onClose();
                }}
                className="action-primary mt-2.5 min-h-9 w-full justify-center text-xs"
              >
                Auf diesem Gerät fortsetzen
              </button>
            </div>
          )}

        {/* Other connected devices */}
        {enabled && (
          <div className="mb-4">
            <p className="label-mono mb-2 text-[10px]">Anderes Gerät auswählen</p>
            {otherDevices.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted">
                Keine weiteren Geräte verbunden. Öffne LoggeRythm auf einem anderen Gerät mit diesem Konto.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {otherDevices.map((device) => {
                  const isSelf = device.device_id === deviceId;
                  const busy = transferringToId === device.device_id;
                  return (
                    <li key={device.device_id}>
                      <button
                        type="button"
                        disabled={Boolean(transferringToId) || !device.capabilities.can_play_audio}
                        onClick={() => handleSelectDevice(device)}
                        className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.07] disabled:opacity-50"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-foreground/[0.06] text-muted">
                          {busy ? (
                            <SpinnerIcon width={16} height={16} className="animate-spin text-accent" />
                          ) : (
                            <DeviceTypeIcon type={device.device_type} width={18} height={18} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {device.name}
                          </span>
                          <span className="block truncate text-[11px] text-muted">
                            {isSelf ? "Dieses Gerät" : deviceTypeLabel(device.device_type)}
                            {device.party_code ? ` · Jam ${device.party_code}` : ""}
                            {!device.capabilities.can_play_audio ? " · Nur Fernbedienung" : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Collaborative Jam section */}
        <div className="border-t border-hairline pt-3">
          <p className="label-mono mb-2 text-[10px]">Gemeinsam hören · Jam</p>
          {partyActive && partyCode ? (
            <div className="space-y-2 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{partyName || partyCode}</p>
                <p className="text-[11px] text-muted">
                  Code {partyCode} · {partyMembersCount} {partyMembersCount === 1 ? "Person" : "Personen"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    router.push(`/party/${encodeURIComponent(partyCode)}`);
                  }}
                  className="action-primary min-h-9 flex-1 px-3 text-xs"
                >
                  Jam öffnen
                </button>
                <button
                  type="button"
                  disabled={leavingJam}
                  onClick={() => void handleLeaveJam()}
                  className="action-secondary min-h-9 px-3 text-xs"
                >
                  {leavingJam ? "Verlässt…" : "Verlassen"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                disabled={startingJam}
                onClick={() => void handleStartJam()}
                className="action-secondary min-h-9 w-full justify-center text-xs"
              >
                <UsersIcon width={15} height={15} />
                {startingJam ? "Jam wird gestartet…" : "Jam starten"}
              </button>
              <form onSubmit={handleJoinJam} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Jam-Code eingeben…"
                  aria-label="Jam-Code eingeben"
                  maxLength={16}
                  className="field-input min-h-9 flex-1 px-3 py-1.5 font-mono text-xs uppercase"
                />
                <button
                  type="submit"
                  disabled={!joinCode.trim()}
                  className="action-secondary min-h-9 px-3 text-xs"
                >
                  Beitreten
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Device name + Connect mode switch */}
        <div className="mt-3 space-y-2.5 border-t border-hairline pt-3">
          {editingName ? (
            <form onSubmit={(e) => void handleRename(e)} className="flex items-center gap-1.5">
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={60}
                autoFocus
                aria-label="Name dieses Geräts"
                className="field-input min-h-9 flex-1 px-3 py-1.5 text-xs"
              />
              <button type="submit" disabled={!draftName.trim()} className="action-primary min-h-9 px-3 text-xs">
                OK
              </button>
              <button type="button" onClick={() => setEditingName(false)} className="action-icon h-9 w-9">
                <CloseIcon width={15} height={15} />
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-muted">
                Dieses Gerät: <strong className="text-foreground">{deviceName}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  setDraftName(deviceName);
                  setEditingName(true);
                }}
                aria-label="Dieses Gerät umbenennen"
                className="action-icon h-8 w-8"
              >
                <EditIcon width={14} height={14} />
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted">Multi-Device Connect</span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                enabled ? "border-accent bg-accent" : "border-border bg-white/10"
              }`}
            >
              <span className="sr-only">Multi-Device Connect umschalten</span>
              <span
                aria-hidden="true"
                className={`h-4 w-4 rounded-full transition-transform ${
                  enabled ? "translate-x-5 bg-on-accent" : "translate-x-1 bg-foreground"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingJamTransfer !== null}
        title={
          pendingJamTransfer
            ? `Jam verlassen und auf „${pendingJamTransfer.name}“ wechseln?`
            : "Gerät wechseln?"
        }
        confirmLabel="Wechseln"
        cancelLabel="Abbrechen"
        busy={leavingForTransfer}
        onCancel={() => setPendingJamTransfer(null)}
        onConfirm={() => void confirmLeaveJamAndTransfer()}
      >
        {partyIsHost
          ? "Deine aktive Jam wird beendet, bevor die Wiedergabe auf das ausgewählte Gerät übertragen wird."
          : "Du verlässt die aktive Jam, bevor die Wiedergabe auf das ausgewählte Gerät übertragen wird."}
      </ConfirmDialog>
    </>,
    document.body,
  );
}
