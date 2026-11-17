"use client";

import Link from "next/link";
import { usePlayerStore, currentTrack } from "@/store/player";
import LikeButton from "@/components/LikeButton";
import EqualizerBars from "@/components/EqualizerBars";
import NowPlaying from "@/components/now-playing/NowPlaying";
import TrackContext from "@/components/TrackContext";
import CacheMarker from "@/components/CacheMarker";
import ArtistLinks from "@/components/ArtistLinks";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import Scrubber, { ProgressLine, rangeFill } from "@/components/player/Scrubber";
import { formatTime } from "@/lib/format";
import { setNowPlayingOpen } from "@/components/player/usePlayerSideEffects";
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
import type { Track } from "@/types";

const openNowPlaying = () => setNowPlayingOpen(true);
const closeNowPlaying = () => setNowPlayingOpen(false);

function Cover({ track, className }: { track: Track; className: string }) {
  return track.cover ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={track.cover} alt="" className={`object-cover ${className}`} />
  ) : (
    <CoverPlaceholder className={className} />
  );
}

function PlayPauseButton({ className, iconSize }: { className: string; iconSize: number }) {
  const hasTrack = usePlayerStore((s) => s.index >= 0);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const toggle = usePlayerStore((s) => s.toggle);
  return (
    <button type="button" onClick={toggle} disabled={!hasTrack} aria-label={isPlaying ? "Pause" : "Abspielen"} className={className}>
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
  const RepeatGlyph = repeat === "one" ? RepeatOneIcon : RepeatIcon;
  const repeatLabel = repeat === "one" ? "Titel wiederholen" : repeat === "all" ? "Alle wiederholen" : "Wiederholen aus";

  return (
    <div className="flex items-center justify-center gap-1.5">
      <button type="button" onClick={toggleShuffle} disabled={!hasTrack} aria-label="Zufallswiedergabe" aria-pressed={shuffle} title="Zufallswiedergabe" className="action-icon relative h-10 w-10">
        <ShuffleIcon width={18} height={18} />
        {shuffle && <ActiveDot />}
      </button>
      <button type="button" onClick={prev} disabled={!hasTrack} aria-label="Vorheriger Titel" title="Vorheriger Titel (Shift+P)" className="action-icon h-11 w-11 text-foreground">
        <PrevIcon width={24} height={24} />
      </button>
      <PlayPauseButton iconSize={24} className="play-fab mx-1.5 h-12 w-12" />
      <button type="button" onClick={next} disabled={!hasTrack} aria-label="Nächster Titel" title="Nächster Titel (Shift+N)" className="action-icon h-11 w-11 text-foreground">
        <NextIcon width={24} height={24} />
      </button>
      <button type="button" onClick={cycleRepeat} disabled={!hasTrack} aria-label="Wiederholen" aria-pressed={repeat !== "off"} title={repeatLabel} className="action-icon relative h-10 w-10">
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
  const level = muted ? 0 : volume;
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={toggleMute} aria-label={muted ? "Ton an" : "Stummschalten"} title="Stummschalten (M)" className="action-icon h-9 w-9">
        {level === 0 ? <VolumeMutedIcon width={18} height={18} /> : <VolumeIcon width={18} height={18} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={level}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="w-20 xl:w-28"
        style={{ background: rangeFill(level * 100) }}
        aria-label="Lautstärke"
        aria-valuetext={`${Math.round(level * 100)} Prozent`}
      />
    </div>
  );
}

function PanelToggles() {
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
      <VolumeControl />
      <button type="button" onClick={openNowPlaying} disabled={!hasTrack} aria-label="Jetzt läuft öffnen" title="Jetzt läuft (F)" className="action-icon h-9 w-9">
        <ExpandIcon width={18} height={18} />
      </button>
    </>
  );
}

function TrackSummary({ track }: { track: Track }) {
  const playing = usePlayerStore((s) => s.isPlaying && !s.isBuffering);
  return (
    <TrackContext track={track} className="flex min-w-0 items-center gap-3.5">
      <button type="button" onClick={openNowPlaying} aria-label="Jetzt läuft öffnen" title="Jetzt läuft öffnen (F)" className="group/cover relative shrink-0 overflow-hidden rounded-[var(--radius-art)] shadow-[0_6px_18px_rgb(0_0_0/0.5)]">
        <Cover track={track} className="h-[60px] w-[60px]" />
        <span className="absolute inset-0 grid place-items-center bg-black/60 opacity-0 transition group-hover/cover:opacity-100 group-focus-visible/cover:opacity-100">
          <ExpandIcon width={18} height={18} />
        </span>
      </button>
      <div className="min-w-0">
        {track.album_id ? (
          <Link href={`/album/${track.album_id}`} className="font-display block truncate text-[15px] font-bold tracking-tight hover:underline">{track.title}</Link>
        ) : (
          <p className="font-display truncate text-[15px] font-bold tracking-tight">{track.title}</p>
        )}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <EqualizerBars height={12} isPlaying={playing} />
          <CacheMarker trackId={track.id} />
          <ArtistLinks track={track} className="truncate text-[13px] text-muted" linkClassName="hover:underline hover:text-foreground" />
        </div>
      </div>
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
function DesktopBar({ track }: { track: Track | null }) {
  return (
    <div className="relative hidden border-t border-hairline bg-backdrop lg:block">
      <div className="seek-edge absolute inset-x-0 top-0 z-10 -translate-y-1/2">
        <Scrubber showTimes={false} />
      </div>
      <div className="grid h-[84px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 px-5">
        {track ? <TrackSummary track={track} /> : <p className="label-mono">Wähle einen Titel zum Abspielen.</p>}
        <div className="flex items-center gap-5">
          <Transport />
          <TimeReadout />
        </div>
        <div className="flex items-center justify-end gap-3">
          <PanelToggles />
        </div>
      </div>
    </div>
  );
}

/** Mobile mini player: a floating card that opens the fullscreen view. */
function MiniPlayer({ track }: { track: Track }) {
  const next = usePlayerStore((s) => s.next);
  return (
    <div className="relative mx-2 mb-2 flex items-center gap-3 overflow-hidden rounded-[var(--radius-control)] border border-hairline bg-panel p-1.5 pr-2 shadow-[0_10px_30px_rgb(0_0_0/0.55)] lg:hidden" style={{ backgroundImage: "linear-gradient(90deg, rgb(var(--ambient) / 0.3), rgb(var(--ambient) / 0.06))" }}>
      <button type="button" onClick={openNowPlaying} aria-label={`${track.title}: Jetzt läuft öffnen`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Cover track={track} className="h-12 w-12 shrink-0 rounded-[var(--radius-art)]" />
        <span className="min-w-0">
          <span className="font-display block truncate text-sm font-bold tracking-tight">{track.title}</span>
          <span className="block truncate text-xs text-muted">{track.artist}</span>
        </span>
      </button>
      <LikeButton key={track.id} track={track} />
      <PlayPauseButton iconSize={22} className="play-fab h-10 w-10 shadow-none" />
      <button type="button" onClick={next} aria-label="Nächster Titel" className="grid h-11 w-9 shrink-0 place-items-center text-foreground">
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
export default function PlayerBar() {
  const track = usePlayerStore(currentTrack);
  const nowPlayingOpen = usePlayerStore((s) => s.nowPlayingOpen);
  return (
    <>
      {nowPlayingOpen && track && <NowPlaying onClose={closeNowPlaying} />}
      <footer aria-label="Musikplayer" className="like-celebration-surface relative z-20 shrink-0 bg-backdrop">
        <PlayerErrors />
        <DesktopBar track={track} />
        {track && <MiniPlayer track={track} />}
      </footer>
    </>
  );
}
