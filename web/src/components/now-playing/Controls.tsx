"use client";

import { usePlayerStore } from "@/store/player";
import { canControlActiveVolume, useConnectStore } from "@/store/connect";
import { canControlPartyPlayback, usePartyStore } from "@/store/party";
import { rangeFill } from "@/components/player/Scrubber";
import {
  PlayIcon,
  PauseIcon,
  NextIcon,
  PrevIcon,
  ShuffleIcon,
  RepeatIcon,
  RepeatOneIcon,
  VolumeIcon,
  VolumeMutedIcon,
  SpinnerIcon,
} from "@/components/icons";

/**
 * Store-connected transport controls for the fullscreen player. Each control
 * subscribes to exactly the store slices it renders; seeking is handled by the
 * shared drag-safe {@link Scrubber}.
 */

export function TransportRow({ className = "" }: { className?: string }) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const partyActive = usePartyStore((s) => s.active);
  const partyDetached = usePartyStore((s) => s.detached);
  const partyIsHost = usePartyStore((s) => s.isHost);
  const partyGuestsCanControl = usePartyStore((s) => s.guestsCanControl);
  const partyHostName = usePartyStore((s) => s.hostName);
  const locked = !canControlPartyPlayback({
    active: partyActive,
    detached: partyDetached,
    isHost: partyIsHost,
    guestsCanControl: partyGuestsCanControl,
  });
  const lockTip = locked ? `${partyHostName || "Host"} steuert die Wiedergabe` : undefined;
  const RepeatGlyph = repeat === "one" ? RepeatOneIcon : RepeatIcon;

  return (
    <div className={`flex items-center justify-between gap-1 sm:justify-center sm:gap-4 ${className}`}>
      <button
        type="button"
        onClick={toggleShuffle}
        disabled={locked}
        aria-label="Zufallswiedergabe"
        aria-pressed={shuffle}
        title={lockTip ?? (shuffle ? "Zufallswiedergabe ausschalten" : "Zufallswiedergabe einschalten")}
        className="action-icon h-11 w-11 text-foreground/82 [filter:drop-shadow(0_1px_6px_rgb(0_0_0/0.75))] hover:text-foreground"
      >
        <ShuffleIcon width={22} height={22} />
      </button>
      <button
        type="button"
        onClick={prev}
        disabled={locked}
        title={lockTip}
        aria-label="Vorheriger Titel"
        className="action-icon h-12 w-12 text-foreground [filter:drop-shadow(0_1px_6px_rgb(0_0_0/0.75))]"
      >
        <PrevIcon width={30} height={30} />
      </button>
      <button
        type="button"
        onClick={toggle}
        disabled={locked}
        aria-label={isPlaying ? "Pause" : "Abspielen"}
        aria-busy={isBuffering}
        title={lockTip ?? (isBuffering ? "Wiedergabe wird geladen" : isPlaying ? "Pause" : "Abspielen")}
        className="play-fab h-16 w-16"
      >
        {isBuffering ? (
          <SpinnerIcon width={28} height={28} aria-hidden className="animate-spin motion-reduce:animate-none" />
        ) : isPlaying ? (
          <PauseIcon width={28} height={28} />
        ) : (
          <PlayIcon width={28} height={28} />
        )}
      </button>
      <button
        type="button"
        onClick={next}
        disabled={locked}
        title={lockTip}
        aria-label="Nächster Titel"
        className="action-icon h-12 w-12 text-foreground [filter:drop-shadow(0_1px_6px_rgb(0_0_0/0.75))]"
      >
        <NextIcon width={30} height={30} />
      </button>
      <button
        type="button"
        onClick={cycleRepeat}
        disabled={locked}
        title={lockTip}
        aria-label={repeat === "one" ? "Wiederholen: ein Titel" : repeat === "all" ? "Wiederholen: alle Titel" : "Wiederholen: aus"}
        aria-pressed={repeat !== "off"}
        className="action-icon h-11 w-11 text-foreground/82 [filter:drop-shadow(0_1px_6px_rgb(0_0_0/0.75))] hover:text-foreground"
      >
        <RepeatGlyph width={22} height={22} />
      </button>
    </div>
  );
}

export function VolumeRow() {
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const enabled = useConnectStore((s) => s.enabled);
  const status = useConnectStore((s) => s.status);
  const activeDeviceId = useConnectStore((s) => s.activeDeviceId);
  const deviceId = useConnectStore((s) => s.deviceId);
  const devices = useConnectStore((s) => s.devices);
  const canControlVolume = canControlActiveVolume({ enabled, status, activeDeviceId, deviceId, devices });
  const tip = !canControlVolume ? "Lautstärke wird direkt am aktiven Gerät geregelt" : undefined;
  return (
    <div className="flex w-full max-w-60 items-center gap-1" title={tip}>
      <button
        type="button"
        onClick={toggleMute}
        disabled={!canControlVolume}
        title={tip}
        aria-label={muted ? "Ton an" : "Stummschalten"}
        aria-pressed={muted}
        className="action-icon h-11 w-11 text-foreground/85 hover:text-foreground"
      >
        {muted || volume === 0 ? <VolumeMutedIcon /> : <VolumeIcon />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        disabled={!canControlVolume}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="min-w-0 flex-1"
        style={{ background: rangeFill((muted ? 0 : volume) * 100) }}
        aria-label="Lautstärke"
        aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} Prozent`}
      />
    </div>
  );
}
