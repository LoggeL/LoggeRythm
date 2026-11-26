"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AUDIO_QUALITY_META } from "@/lib/audioIntelligence";
import { useMe } from "@/hooks/useAuth";
import { usePlayerStore, currentTrack } from "@/store/player";
import { canControlActiveVolume, useConnectStore } from "@/store/connect";
import { canControlPartyPlayback, usePartyStore } from "@/store/party";
import LikeButton from "@/components/LikeButton";
import EqualizerBars from "@/components/EqualizerBars";
import NowPlaying from "@/components/now-playing/NowPlaying";
import TrackContext from "@/components/TrackContext";
import CacheMarker from "@/components/CacheMarker";
import ArtistLinks from "@/components/ArtistLinks";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import Scrubber, { ProgressLine, rangeFill } from "@/components/player/Scrubber";
import { DeviceSelectorTrigger } from "@/components/player/DeviceSelector";
import { SleepTimerTrigger } from "@/components/player/SleepTimerControl";
import { AudioEffectsTrigger } from "@/components/player/AudioEffectsControl";
import PictureInPictureButton from "@/components/player/PictureInPictureButton";
import ActiveOutputBanner from "@/components/player/ActiveOutputBanner";
import { formatTime } from "@/lib/format";
import { NAV_FORWARD } from "@/lib/morph";
import { setNowPlayingOpen } from "@/components/player/usePlayerSideEffects";
import TrackSwap from "@/components/player/TrackSwap";
import { trackSwapNeighbour, trackSwapSlot, type TrackSwapSlot } from "@/lib/trackSwap";
import {
  PlayIcon,
  PauseIcon,
  NextIcon,
  PrevIcon,
  VolumeIcon,
  VolumeMutedIcon,
  ShuffleIcon,
  RepeatIcon,
  RepeatOneIcon,
  QueueIcon,
  LyricsIcon,
  SpinnerIcon,
  ExpandIcon,
} from "@/components/icons";
import type { PlaybackSettings, Track } from "@/types";

const openNowPlaying = () => setNowPlayingOpen(true);
const closeNowPlaying = () => setNowPlayingOpen(false);

function Cover({ track, className }: { track: Track; className: string }) {
  return track.cover ? (
    // Keyed by URL: a reused <img> keeps painting the previous cover until the
    // new one loads, so a track change would slide in the old picture. A fresh
    // one shows the brand gradient until the new cover arrives.
    // eslint-disable-next-line @next/next/no-img-element
    <img key={track.cover} src={track.cover} alt="" className={`gradient-brand object-cover ${className}`} />
  ) : (
    <CoverPlaceholder className={className} />
  );
}

/** Queue position of the playing track, so track changes slide in their direction of travel. */
function useTrackSwapSlot(): TrackSwapSlot | null {
  const trackId = usePlayerStore((s) => currentTrack(s)?.id ?? null);
  const index = usePlayerStore((s) => s.index);
  const length = usePlayerStore((s) => s.queue.length);
  const prevId = usePlayerStore((s) => trackSwapNeighbour(s.queue, s.index, s.repeat, -1));
  const nextId = usePlayerStore((s) => trackSwapNeighbour(s.queue, s.index, s.repeat, 1));
  return useMemo(
    () => trackSwapSlot(trackId, index, length, prevId, nextId),
    [trackId, index, length, prevId, nextId],
  );
}

function usePlaybackLock(): { locked: boolean; reason?: string } {
  const active = usePartyStore((s) => s.active);
  const detached = usePartyStore((s) => s.detached);
  const isHost = usePartyStore((s) => s.isHost);
  const guestsCanControl = usePartyStore((s) => s.guestsCanControl);
  const hostName = usePartyStore((s) => s.hostName);
  const allowed = canControlPartyPlayback({ active, detached, isHost, guestsCanControl });
  return allowed ? { locked: false } : { locked: true, reason: `${hostName || "Host"} steuert die Wiedergabe` };
}

function PlayPauseButton({ className, iconSize }: { className: string; iconSize: number }) {
  const hasTrack = usePlayerStore((s) => s.index >= 0);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const toggle = usePlayerStore((s) => s.toggle);
  const lock = usePlaybackLock();
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!hasTrack || lock.locked}
      title={lock.reason ?? (isPlaying ? "Pause" : "Abspielen")}
      aria-label={isPlaying ? "Pause" : "Abspielen"}
      className={className}
    >
      {isBuffering ? (
        <SpinnerIcon width={iconSize} height={iconSize} className="animate-spin" />
      ) : isPlaying ? (
        <PauseIcon width={iconSize} height={iconSize} />
      ) : (
        <PlayIcon width={iconSize} height={iconSize} />
      )}
    </button>
  );
}

function Transport() {
  const hasTrack = usePlayerStore((s) => s.index >= 0);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const lock = usePlaybackLock();
  const RepeatGlyph = repeat === "one" ? RepeatOneIcon : RepeatIcon;
  const repeatLabel = repeat === "one" ? "Titel wiederholen" : repeat === "all" ? "Alle wiederholen" : "Wiederholen aus";

  return (
    <div className="flex items-center justify-center gap-1.5">
      <button type="button" onClick={toggleShuffle} disabled={!hasTrack || lock.locked} aria-label="Zufallswiedergabe" aria-pressed={shuffle} title={lock.reason ?? "Zufallswiedergabe"} className="action-icon relative h-10 w-10">
        <ShuffleIcon width={18} height={18} />
        {shuffle && <ActiveDot />}
      </button>
      <button type="button" onClick={prev} disabled={!hasTrack || lock.locked} aria-label="Vorheriger Titel" title={lock.reason ?? "Vorheriger Titel (Shift+P)"} className="action-icon h-11 w-11 text-foreground">
        <PrevIcon width={24} height={24} />
      </button>
      <PlayPauseButton iconSize={24} className="play-fab mx-1.5 h-12 w-12" />
      <button type="button" onClick={next} disabled={!hasTrack || lock.locked} aria-label="Nächster Titel" title={lock.reason ?? "Nächster Titel (Shift+N)"} className="action-icon h-11 w-11 text-foreground">
        <NextIcon width={24} height={24} />
      </button>
      <button type="button" onClick={cycleRepeat} disabled={!hasTrack || lock.locked} aria-label="Wiederholen" aria-pressed={repeat !== "off"} title={lock.reason ?? repeatLabel} className="action-icon relative h-10 w-10">
        <RepeatGlyph width={18} height={18} />
        {repeat !== "off" && <ActiveDot />}
      </button>
    </div>
  );
}

function ActiveDot() {
  return <span aria-hidden="true" className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent-soft" />;
}

/** Elapsed / total, read out next to the transport; the seek bar itself is the deck's top edge. */
function TimeReadout() {
  const currentTime = usePlayerStore((s) => Math.floor(s.currentTime));
  const duration = usePlayerStore((s) => s.duration);
  return (
    <p aria-hidden="true" className="font-mono text-[11.5px] tabular-nums text-subtle">
      <span className="text-foreground">{formatTime(currentTime)}</span> / {formatTime(duration || 0)}
    </p>
  );
}

function VolumeControl() {
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
  const level = muted ? 0 : volume;
  const disabledTip = !canControlVolume ? "Lautstärke wird direkt am aktiven Gerät geregelt" : undefined;
  return (
    <div className="flex items-center gap-1" title={disabledTip}>
      <button
        type="button"
        onClick={toggleMute}
        disabled={!canControlVolume}
        aria-label={muted ? "Ton an" : "Stummschalten"}
        title={disabledTip ?? "Stummschalten (M)"}
        className="action-icon h-9 w-9"
      >
        {level === 0 ? <VolumeMutedIcon width={18} height={18} /> : <VolumeIcon width={18} height={18} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={level}
        disabled={!canControlVolume}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="w-20 xl:w-28"
        style={{ background: rangeFill(level * 100) }}
        aria-label="Lautstärke"
        aria-valuetext={`${Math.round(level * 100)} Prozent`}
      />
    </div>
  );
}

function PanelToggles({ offlineOnly = false }: { offlineOnly?: boolean }) {
  const hasTrack = usePlayerStore((s) => s.index >= 0);
  const queueOpen = usePlayerStore((s) => s.queueOpen);
  const toggleQueue = usePlayerStore((s) => s.toggleQueue);
  const lyricsOpen = usePlayerStore((s) => s.lyricsOpen);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);
  return (
    <>
      <button type="button" onClick={toggleLyrics} aria-label="Songtext" aria-pressed={lyricsOpen} title="Songtext (T)" className="action-icon relative h-9 w-9">
        <LyricsIcon width={18} height={18} />
        {lyricsOpen && <ActiveDot />}
      </button>
      <button type="button" onClick={toggleQueue} aria-label="Warteschlange" aria-pressed={queueOpen} title="Warteschlange (Q)" className="action-icon relative h-9 w-9">
        <QueueIcon width={18} height={18} />
        {queueOpen && <ActiveDot />}
      </button>
      <AudioEffectsTrigger />
      <SleepTimerTrigger />
      {!offlineOnly && <DeviceSelectorTrigger />}
      <VolumeControl />
      <PictureInPictureButton />
      <button type="button" onClick={openNowPlaying} disabled={!hasTrack} aria-label="Jetzt läuft öffnen" title="Jetzt läuft (F)" className="action-icon h-9 w-9">
        <ExpandIcon width={18} height={18} />
      </button>
    </>
  );
}

function QualityBadge({ offlineOnly }: { offlineOnly: boolean }) {
  const { data: me } = useMe();
  const { data: settings } = useQuery<PlaybackSettings>({
    queryKey: ["playback-settings"],
    queryFn: api.settings,
    enabled: Boolean(!offlineOnly && me?.is_approved),
    staleTime: 5 * 60_000,
  });
  if (offlineOnly || !settings?.preferred_quality) return null;
  const meta = AUDIO_QUALITY_META[settings.preferred_quality];
  return (
    <span
      title={`Audioqualität: ${meta.label}`}
      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold leading-none tracking-[0.08em] ${
        settings.preferred_quality === "lossless"
          ? "border-accent/45 bg-accent/12 text-accent"
          : "border-hairline bg-white/[0.04] text-subtle"
      }`}
    >
      {meta.badge}
    </span>
  );
}

function TrackSummary({ track, offlineOnly = false }: { track: Track; offlineOnly?: boolean }) {
  const playing = usePlayerStore((s) => s.isPlaying && !s.isBuffering);
  const slot = useTrackSwapSlot();
  return (
    <TrackContext track={track} className="flex min-w-0 items-center gap-3.5">
      <button type="button" onClick={openNowPlaying} aria-label="Jetzt läuft öffnen" title="Jetzt läuft öffnen (F)" className="group/cover relative shrink-0 overflow-hidden rounded-[var(--radius-art)] shadow-[0_6px_18px_rgb(0_0_0/0.5)]">
        <TrackSwap slot={slot} item={track}>
          {(shown) => (
            <span data-swap-part="art" className="block">
              <Cover track={shown} className="h-[60px] w-[60px]" />
            </span>
          )}
        </TrackSwap>
        <span className="absolute inset-0 z-[2] grid place-items-center bg-black/60 opacity-0 transition group-hover/cover:opacity-100 group-focus-visible/cover:opacity-100">
          <ExpandIcon width={18} height={18} />
        </span>
      </button>
      <TrackSwap slot={slot} item={track}>
        {(shown) => (
          <div data-swap-part="text" className="min-w-0">
            {shown.album_id ? (
              <Link href={`/album/${shown.album_id}`} transitionTypes={NAV_FORWARD} className="font-display block truncate text-[15px] font-bold tracking-tight hover:underline">{shown.title}</Link>
            ) : (
              <p className="font-display truncate text-[15px] font-bold tracking-tight">{shown.title}</p>
            )}
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <EqualizerBars height={12} isPlaying={playing} />
              <CacheMarker trackId={shown.id} />
              <QualityBadge offlineOnly={offlineOnly} />
              <ArtistLinks track={shown} className="truncate text-[13px] text-muted" linkClassName="hover:underline hover:text-foreground" />
            </div>
          </div>
        )}
      </TrackSwap>
      <LikeButton key={track.id} track={track} />
    </TrackContext>
  );
}

function PlayerErrors() {
  const error = usePlayerStore((s) => s.error);
  const preloadError = usePlayerStore((s) => s.preloadError);
  const message = error || preloadError;
  if (!message) return null;
  return (
    <div role="alert" className="error-panel mx-2 mb-2 py-2 text-xs" title={message}>
      {message}
    </div>
  );
}

/**
 * Desktop deck: the seek bar is its full-width top edge; below it sit the
 * track, the transport with a time readout, and the panel toggles.
 */
function DesktopBar({ track, offlineOnly = false }: { track: Track | null; offlineOnly?: boolean }) {
  const lock = usePlaybackLock();
  return (
    <div className="relative hidden border-t border-hairline bg-backdrop lg:block">
      <div className="seek-edge absolute inset-x-0 top-0 z-10 -translate-y-1/2">
        <Scrubber showTimes={false} disabled={lock.locked} />
      </div>
      <div className="grid h-[84px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 px-5">
        {track ? <TrackSummary track={track} offlineOnly={offlineOnly} /> : <p className="label-mono">Wähle einen Titel zum Abspielen.</p>}
        <div className="flex items-center gap-5">
          <Transport />
          <TimeReadout />
        </div>
        <div className="flex items-center justify-end gap-3">
          <PanelToggles offlineOnly={offlineOnly} />
        </div>
      </div>
      <ActiveOutputBanner />
    </div>
  );
}

/** Mobile mini player: a floating card that opens the fullscreen view. */
function MiniPlayer({
  track,
  offlineOnly = false,
  enter,
  onEntered,
}: {
  track: Track;
  offlineOnly?: boolean;
  /** Rise in once (playback just started); `onEntered` reports when that is over. */
  enter: boolean;
  onEntered: () => void;
}) {
  const next = usePlayerStore((s) => s.next);
  const lock = usePlaybackLock();
  const slot = useTrackSwapSlot();
  const cardRef = useRef<HTMLDivElement>(null);
  // Drop the entrance class once it ran, so showing the card again (a resize
  // across the desktop breakpoint) never replays it. Inner track-swap and cover
  // animations bubble up here and do not count.
  useEffect(() => {
    const card = cardRef.current;
    if (card === null) throw new Error("MiniPlayer: card element is not mounted");
    const finish = (event: Event) => {
      if (event.target === card) onEntered();
    };
    card.addEventListener("animationend", finish);
    card.addEventListener("animationcancel", finish);
    return () => {
      card.removeEventListener("animationend", finish);
      card.removeEventListener("animationcancel", finish);
    };
  }, [onEntered]);
  // A hidden card (desktop layout) or reduced motion runs no entrance at all.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (card === null) throw new Error("MiniPlayer: card element is not mounted");
    if (enter && card.getAnimations().length === 0) onEntered();
  }, [enter, onEntered]);
  return (
    <div ref={cardRef} className={`relative mx-2 mb-2 flex items-center gap-2 overflow-hidden rounded-[var(--radius-control)] border border-hairline bg-panel p-1.5 pr-2 shadow-[0_10px_30px_rgb(0_0_0/0.55)] ${enter ? "animate-in" : ""}`} style={{ backgroundImage: "linear-gradient(90deg, rgb(var(--ambient) / 0.3), rgb(var(--ambient) / 0.06))" }}>
      <button type="button" onClick={openNowPlaying} aria-label={`${track.title}: Jetzt läuft öffnen`} className="flex min-w-0 flex-1 items-center text-left">
        <TrackSwap slot={slot} item={track} className="flex-1">
          {(shown) => (
            <span className="flex min-w-0 items-center gap-3">
              <span data-swap-part="art" className="shrink-0">
                <Cover track={shown} className="block h-12 w-12 rounded-[var(--radius-art)]" />
              </span>
              <span data-swap-part="text" className="min-w-0">
                <span className="font-display block truncate text-sm font-bold tracking-tight">{shown.title}</span>
                <span className="block truncate text-xs text-muted">{shown.artist}</span>
              </span>
            </span>
          )}
        </TrackSwap>
      </button>
      {!offlineOnly && <DeviceSelectorTrigger compact />}
      <LikeButton key={track.id} track={track} />
      <PlayPauseButton iconSize={22} className="play-fab h-10 w-10 shadow-none" />
      <button type="button" onClick={next} disabled={lock.locked} aria-label="Nächster Titel" className="grid h-11 w-9 shrink-0 place-items-center text-foreground disabled:opacity-40">
        <NextIcon width={22} height={22} />
      </button>
      <ProgressLine />
    </div>
  );
}

/**
 * Player chrome. Purely presentational: playback itself is owned by
 * PlaybackEngine, and everything here reads from the player store.
 */
export default function PlayerBar({ offlineOnly = false }: { offlineOnly?: boolean }) {
  const track = usePlayerStore(currentTrack);
  const nowPlayingOpen = usePlayerStore((s) => s.nowPlayingOpen);
  // The mini player rises in when playback starts, not when a page loads with a
  // restored track: a restored session loads paused, while starting playback
  // sets the track and `isPlaying` in the same update.
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const hasTrack = track !== null;
  const [hadTrack, setHadTrack] = useState(hasTrack);
  const [enterMini, setEnterMini] = useState(false);
  if (hasTrack !== hadTrack) {
    setHadTrack(hasTrack);
    setEnterMini(hasTrack && isPlaying);
  }
  const miniEntered = useCallback(() => setEnterMini(false), []);
  return (
    <>
      {nowPlayingOpen && track && <NowPlaying onClose={closeNowPlaying} />}
      <footer aria-label="Musikplayer" className="like-celebration-surface relative z-20 shrink-0 bg-backdrop">
        <PlayerErrors />
        <DesktopBar track={track} offlineOnly={offlineOnly} />
        {/* The banner stays mounted while the mini player comes and goes. */}
        <div className="lg:hidden">
          <ActiveOutputBanner compact />
          {track && <MiniPlayer track={track} offlineOnly={offlineOnly} enter={enterMini} onEntered={miniEntered} />}
        </div>
      </footer>
    </>
  );
}
