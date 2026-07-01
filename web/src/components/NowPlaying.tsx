"use client";

import ArtistLinks from "@/components/ArtistLinks";
import TrackTitle from "@/components/TrackTitle";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePlayerStore, currentTrack } from "@/store/player";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { useLyrics } from "@/hooks/useLyrics";
import CompactLyrics from "@/components/CompactLyrics";
import LikeButton from "@/components/LikeButton";
import Visualizer from "@/components/Visualizer";
import EqualizerBars from "@/components/EqualizerBars";
import { useBassGlow } from "@/hooks/useBassGlow";
import { useCoverColors, type CoverPalette } from "@/hooks/useCoverColors";
import { hiResCover } from "@/lib/cover";
import type { Track } from "@/types";
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
  ChevronDownIcon,
  MusicNoteIcon,
  PlusIcon,
} from "@/components/icons";

type NowPlayingTab = "playing" | "lyrics" | "similar" | "queue";

export default function NowPlaying({ onClose }: { onClose: () => void }) {
  // Fullscreen opens on the lyrics tab by default.
  const [tab, setTab] = useState<NowPlayingTab>("lyrics");
  const track = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);

  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);

  // Colour palette derived from the cover art — themes the glow + visualizer.
  const palette = useCoverColors(track?.cover);
  // Bass-reactive pulse on the lyrics/similar tab's left-column cover — dips
  // below 1 between kicks and swings well past it for lively movement.
  const lyricsCoverRef = useBassGlow<HTMLDivElement>(isPlaying, {
    baseSpread: 24,
    peakSpread: 150,
    baseAlpha: 0.22,
    peakAlpha: 0.9,
    baseScale: 0.9,
    maxScale: 0.22,
    tintBorder: false,
    color: palette?.rgb,
  });

  // The queue tab is mobile-only (desktop shows the queue column); if the
  // viewport grows to lg while it's active, fall back to the playing tab.
  useEffect(() => {
    if (tab !== "queue") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => e.matches && setTab("playing");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [tab]);

  if (!track) return null;
  const RepeatGlyph = repeat === "one" ? RepeatOneIcon : RepeatIcon;
  const isPlayingView = tab === "playing";

  // Override the accent CSS variables from the cover palette so every
  // accent-coloured element in the fullscreen (tabs, sliders, play button,
  // queue highlights, equalizer, active lyric line…) is themed automatically.
  const accentStyle = palette
    ? ({
        "--accent": palette.primary,
        "--accent-hover": palette.secondary,
        "--accent-soft": palette.gradient[2],
      } as CSSProperties)
    : undefined;
  const [br, bg, bb] = palette?.rgb ?? [124, 92, 255];
  const backdropBg = `radial-gradient(120% 80% at 50% -10%, rgba(${br}, ${bg}, ${bb}, 0.22), transparent 55%), linear-gradient(to bottom, rgba(10,10,20,0.55), rgba(10,10,20,0.92))`;

  return (
    <div
      style={accentStyle}
      className="animate-in fixed inset-0 z-[80] flex h-dvh flex-col overflow-hidden bg-background px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] md:p-8"
    >
      {/* Ambient backdrop from the cover art */}
      {track.cover && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hiResCover(track.cover)}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-40 blur-3xl saturate-150"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: backdropBg }}
          />
        </>
      )}

      <div className="relative flex flex-shrink-0 items-center justify-between mb-3 md:mb-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="grid h-10 w-10 place-items-center rounded-full text-muted transition hover:bg-white/10 hover:text-foreground"
        >
          <ChevronDownIcon width={24} height={24} />
        </button>
        <span className="text-base font-extrabold tracking-tight">
          <span className="text-foreground">Logge</span>
          <span className="mx-0.5 text-white/35">|</span>
          <span className="text-accent">Rythm</span>
        </span>
        <span className="w-10" />
      </div>

      <div className="relative mx-auto mb-3 flex max-w-full flex-shrink-0 overflow-x-auto rounded-full bg-white/5 p-1 ring-1 ring-white/10 no-scrollbar md:mb-6">
        {(
          [
            ["playing", "Jetzt läuft"],
            ["lyrics", "Songtext"],
            ["similar", "Ähnliche Titel"],
            // Queue has its own column on desktop, so it's a mobile-only tab.
            ["queue", "Warteschlange", true],
          ] as [NowPlayingTab, string, boolean?][]
        ).map(([key, label, mobileOnly]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`${mobileOnly ? "lg:hidden " : ""}min-w-24 rounded-full px-3 py-2 text-xs font-semibold transition sm:min-w-28 sm:px-5 sm:text-sm ${
                active
                  ? "bg-accent text-white shadow-lg shadow-accent/30"
                  : "text-muted hover:bg-white/5 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        className={`relative flex min-h-0 flex-1 flex-col lg:grid lg:gap-8 xl:gap-10 ${
          isPlayingView
            ? "lg:grid-cols-[minmax(0,2.2fr)_0.9fr]"
            : "lg:grid-cols-[1.05fr_1.2fr_0.9fr]"
        }`}
      >
        {/* Left: cover + transport — desktop grid column for the lyrics/similar
            tabs (the playing tab uses the full EpicPlayingPanel instead). */}
        <div
          className={`min-h-0 flex-col no-scrollbar lg:overflow-visible ${
            isPlayingView ? "hidden" : "hidden lg:flex"
          }`}
        >
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8">
            <div
              ref={lyricsCoverRef}
              className="aspect-square w-full max-w-md rounded-[1.75rem] will-change-transform xl:max-w-lg"
            >
              {track.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={hiResCover(track.cover)}
                  alt={track.album}
                  className="h-full w-full rounded-[1.75rem] object-cover shadow-2xl"
                />
              ) : (
                <div className="h-full w-full rounded-[1.75rem] gradient-violet opacity-80" />
              )}
            </div>

            <div className="w-full max-w-md text-center">
              <div className="flex items-center justify-center gap-3">
                <TrackTitle
                  track={track}
                  onNavigate={onClose}
                  className="min-w-0 truncate text-3xl font-extrabold hover:underline"
                />
                <LikeButton track={track} />
              </div>
              <ArtistLinks
                track={track}
                onNavigate={onClose}
                className="mt-1 block text-muted"
                linkClassName="hover:text-foreground hover:underline"
              />
            </div>
          </div>

          <div className="mx-auto mt-8 w-full max-w-md">
            <Visualizer
              isPlaying={isPlaying}
              className="mb-5 h-16 w-full"
              colors={palette?.gradient}
              glow={palette ? palette.primary : undefined}
            />
            <SeekBar
              currentTime={currentTime}
              duration={duration}
              onSeek={seek}
            />
            <TransportRow
              isPlaying={isPlaying}
              shuffle={shuffle}
              repeat={repeat}
              repeatGlyph={RepeatGlyph}
              onToggle={toggle}
              onNext={next}
              onPrev={prev}
              onToggleShuffle={toggleShuffle}
              onCycleRepeat={cycleRepeat}
            />
            <VolumeRow
              muted={muted}
              volume={volume}
              onToggleMute={toggleMute}
              onVolume={setVolume}
            />
          </div>
        </div>

        {tab === "queue" ? (
          <NowPlayingQueue
            onClose={onClose}
            className="flex min-h-0 flex-1 flex-col lg:hidden"
          />
        ) : tab === "similar" ? (
          <SimilarTracksPanel seedId={track.id} onClose={onClose} />
        ) : tab === "playing" ? (
          <EpicPlayingPanel
            track={track}
            onClose={onClose}
            palette={palette}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            repeatGlyph={RepeatGlyph}
            shuffle={shuffle}
            repeat={repeat}
            muted={muted}
            volume={volume}
            onSeek={seek}
            onToggle={toggle}
            onNext={next}
            onPrev={prev}
            onToggleShuffle={toggleShuffle}
            onCycleRepeat={cycleRepeat}
            onToggleMute={toggleMute}
            onVolume={setVolume}
          />
        ) : (
          <>
            <CompactLyrics
              track={track}
              palette={palette}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              onSeek={seek}
              onToggle={toggle}
              onNext={next}
              onPrev={prev}
              onNavigate={onClose}
            />
            <LyricsPanel
              artist={track.artist}
              title={track.title}
              trackId={track.id}
              currentTime={currentTime}
              onSeek={seek}
            />
          </>
        )}

        {/* Right: queue (desktop only — third column) */}
        <NowPlayingQueue onClose={onClose} />
      </div>
    </div>
  );
}

/* ----------------------------- shared controls ---------------------------- */

function SeekBar({
  currentTime,
  duration,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-2">
      <span className="w-10 text-right text-xs tabular-nums text-muted">
        {formatTime(currentTime)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(currentTime, duration || 0)}
        onChange={(e) => onSeek(Number(e.target.value))}
        disabled={!duration}
        className="flex-1"
        style={{
          background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${
            duration ? (currentTime / duration) * 100 : 0
          }%, #4d4d57 ${duration ? (currentTime / duration) * 100 : 0}%, #4d4d57 100%)`,
        }}
        aria-label="Fortschritt"
      />
      <span className="w-10 text-xs tabular-nums text-muted">
        {formatTime(duration)}
      </span>
    </div>
  );
}

function TransportRow({
  isPlaying,
  shuffle,
  repeat,
  repeatGlyph: RepeatGlyph,
  onToggle,
  onNext,
  onPrev,
  onToggleShuffle,
  onCycleRepeat,
}: {
  isPlaying: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  repeatGlyph: typeof RepeatIcon;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-center gap-5 md:mt-6 md:gap-7">
      <button
        type="button"
        onClick={onToggleShuffle}
        aria-label="Zufallswiedergabe"
        className={shuffle ? "text-accent" : "text-muted hover:text-foreground"}
      >
        <ShuffleIcon width={22} height={22} />
      </button>
      <button
        type="button"
        onClick={onPrev}
        aria-label="Vorheriger Titel"
        className="text-muted transition hover:text-foreground"
      >
        <PrevIcon width={30} height={30} />
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-label={isPlaying ? "Pause" : "Abspielen"}
        className="grid h-16 w-16 place-items-center rounded-full bg-accent text-white shadow-[0_0_34px_rgba(124,92,255,0.65)] transition hover:scale-105 md:h-[4.5rem] md:w-[4.5rem]"
      >
        {isPlaying ? (
          <PauseIcon width={30} height={30} />
        ) : (
          <PlayIcon width={30} height={30} />
        )}
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label="Nächster Titel"
        className="text-muted transition hover:text-foreground"
      >
        <NextIcon width={30} height={30} />
      </button>
      <button
        type="button"
        onClick={onCycleRepeat}
        aria-label="Wiederholen"
        className={
          repeat !== "off" ? "text-accent" : "text-muted hover:text-foreground"
        }
      >
        <RepeatGlyph width={22} height={22} />
      </button>
    </div>
  );
}

function VolumeRow({
  muted,
  volume,
  onToggleMute,
  onVolume,
}: {
  muted: boolean;
  volume: number;
  onToggleMute: () => void;
  onVolume: (v: number) => void;
}) {
  return (
    <div className="mt-5 hidden items-center justify-center gap-2 sm:flex">
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? "Ton an" : "Stummschalten"}
        className="text-muted hover:text-foreground"
      >
        {muted || volume === 0 ? <VolumeMutedIcon /> : <VolumeIcon />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(e) => onVolume(Number(e.target.value))}
        className="w-44"
        style={{
          background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${
            (muted ? 0 : volume) * 100
          }%, #4d4d57 ${(muted ? 0 : volume) * 100}%, #4d4d57 100%)`,
        }}
        aria-label="Lautstärke"
      />
    </div>
  );
}

/* ------------------------------- queue panel ------------------------------ */

function NowPlayingQueue({
  className = "hidden lg:flex flex-col min-h-0",
  onClose,
}: {
  className?: string;
  onClose: () => void;
}) {
  const queue = usePlayerStore((s) => s.queue);
  const origins = usePlayerStore((s) => s.origins);
  const queueContext = usePlayerStore((s) => s.queueContext);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const cur = usePlayerStore(currentTrack);
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const clearQueue = usePlayerStore((s) => s.clearQueue);

  const upcoming = queue
    .map((t, i) => ({ t, i }))
    .filter(({ i }) => i > index);
  const userUpcoming = upcoming.filter(({ i }) => origins[i] === "user");
  const contextUpcoming = upcoming.filter(({ i }) => origins[i] !== "user");

  const renderItem = ({ t, i }: { t: Track; i: number }) => (
    <li
      key={`${t.id}-${i}`}
      className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/5"
    >
      <button
        type="button"
        onClick={() => jumpTo(i)}
        aria-label={`${t.title} abspielen`}
        className="relative flex-shrink-0 group/cover"
      >
        {t.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={t.cover}
            alt=""
            className="h-11 w-11 rounded-lg object-cover"
          />
        ) : (
          <div className="h-11 w-11 rounded-lg gradient-violet opacity-80" />
        )}
        <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/50 opacity-0 transition group-hover/cover:opacity-100">
          <PlayIcon width={16} height={16} className="text-white" />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <TrackTitle
          track={t}
          onNavigate={onClose}
          className="block truncate text-sm hover:underline"
        />
        <ArtistLinks
          track={t}
          onNavigate={onClose}
          className="block truncate text-xs text-muted"
          linkClassName="hover:text-foreground hover:underline"
        />
      </div>
      <span className="text-xs tabular-nums text-muted">
        {formatTime(t.duration_sec)}
      </span>
    </li>
  );

  return (
    <div className={className}>
      <div className="mb-4 flex flex-shrink-0 items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Warteschlange
        </span>
        {upcoming.length > 0 && (
          <button
            type="button"
            onClick={clearQueue}
            className="press rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-muted transition hover:bg-white/10 hover:text-foreground"
          >
            Leeren
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-area pr-1">
        {cur && (
          <>
            <p className="mb-2 text-[11px] uppercase tracking-widest text-accent">
              Aktueller Titel
            </p>
            <div className="mb-5 flex items-center gap-3 rounded-2xl bg-accent/10 px-3 py-3 ring-1 ring-accent/25">
              {cur.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cur.cover}
                  alt=""
                  className="h-11 w-11 rounded-lg object-cover shadow"
                />
              ) : (
                <div className="h-11 w-11 rounded-lg gradient-violet opacity-80" />
              )}
              <div className="min-w-0 flex-1">
                <TrackTitle
                  track={cur}
                  onNavigate={onClose}
                  className="block truncate text-sm font-semibold text-accent hover:underline"
                />
                <ArtistLinks
                  track={cur}
                  onNavigate={onClose}
                  className="block truncate text-xs text-muted"
                  linkClassName="hover:text-foreground hover:underline"
                />
              </div>
              {isPlaying && <EqualizerBars height={16} barClassName="bg-accent" />}
            </div>
          </>
        )}

        {userUpcoming.length > 0 && (
          <>
            <p className="mb-2 text-[11px] uppercase tracking-widest text-muted">
              Als Nächstes in der Warteschlange
            </p>
            <ul className="mb-5 flex flex-col">{userUpcoming.map(renderItem)}</ul>
          </>
        )}

        {contextUpcoming.length > 0 && (
          <>
            <p className="mb-2 text-[11px] uppercase tracking-widest text-muted">
              {queueContext ? `Als Nächstes: ${queueContext}` : "Als Nächstes"}
            </p>
            <ul className="flex flex-col">{contextUpcoming.map(renderItem)}</ul>
          </>
        )}

        {!cur && upcoming.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted">
            Die Warteschlange ist leer.
          </p>
        )}
      </div>
    </div>
  );
}

/* --------------------------- the playing centerpiece ---------------------- */

function EpicPlayingPanel({
  track,
  onClose,
  palette,
  isPlaying,
  currentTime,
  duration,
  repeatGlyph: RepeatGlyph,
  shuffle,
  repeat,
  muted,
  volume,
  onSeek,
  onToggle,
  onNext,
  onPrev,
  onToggleShuffle,
  onCycleRepeat,
  onToggleMute,
  onVolume,
}: {
  track: NonNullable<ReturnType<typeof currentTrack>>;
  onClose: () => void;
  palette: CoverPalette | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  repeatGlyph: typeof RepeatIcon;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  muted: boolean;
  volume: number;
  onSeek: (t: number) => void;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleMute: () => void;
  onVolume: (v: number) => void;
}) {
  // Bass-reactive pulse + glow on the album art — hard scale punch on kicks.
  const albumRef = useBassGlow<HTMLDivElement>(isPlaying, {
    baseSpread: 40,
    peakSpread: 130,
    baseAlpha: 0.32,
    peakAlpha: 0.95,
    maxScale: 0.16,
    tintBorder: false,
    color: palette?.rgb,
  });
  // Strong bass-reactive pulse on the surrounding panel border (no scale).
  const panelRef = useBassGlow<HTMLDivElement>(isPlaying, {
    baseSpread: 14,
    peakSpread: 75,
    baseAlpha: 0.08,
    peakAlpha: 0.9,
    maxScale: 0,
    tintBorder: true,
    color: palette?.rgb,
  });

  // Cover-derived theming (falls back to the brand violet when unavailable).
  const [gr, gg, gb] = palette?.rgb ?? [124, 92, 255];
  const auraBg = `rgba(${gr}, ${gg}, ${gb}, 0.3)`;
  const ambientBg = `radial-gradient(circle at 50% 26%, rgba(${gr}, ${gg}, ${gb}, 0.34), transparent 46%), linear-gradient(to bottom, rgba(10,10,20,0.2), rgba(10,10,20,0.92))`;
  const frameBg = palette
    ? `conic-gradient(from 135deg, ${palette.secondary}, ${palette.primary}, ${palette.gradient[2]}, ${palette.secondary})`
    : "conic-gradient(from 135deg, #3b82ff, #7c5cff, #ff6ec7, #3b82ff)";

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:mt-0">
      <span className="sr-only lg:not-sr-only lg:mb-4 lg:flex-shrink-0 lg:text-[11px] lg:font-semibold lg:uppercase lg:tracking-widest lg:text-muted">
        Jetzt läuft
      </span>
      {/* No overflow-hidden on the panel itself so the album's bass glow + scale
          can spill past the edges; the backdrop + visualizer are clipped by
          their own rounded wrappers instead. */}
      <div
        ref={panelRef}
        className="relative min-h-0 flex-1 rounded-[1.75rem] border border-white/10 bg-white/[0.04] backdrop-blur-2xl will-change-[box-shadow] md:rounded-[2.25rem]"
      >
        {track.cover && (
          <div className="absolute inset-0 overflow-hidden rounded-[1.75rem] md:rounded-[2.25rem]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hiResCover(track.cover)}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-125 object-cover opacity-30 blur-3xl saturate-150"
            />
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ background: ambientBg }}
            />
          </div>
        )}

        <div className="relative z-10 flex h-full min-h-0 flex-col items-center gap-3 p-4 pb-14 md:gap-5 md:p-7 md:pb-24">
          {/* Album centerpiece with a bass-reactive aura + gradient frame */}
          <div className="relative grid w-full min-h-0 flex-1 place-items-center">
            <div
              aria-hidden
              className="absolute aspect-square w-[min(52vw,30vh)] rounded-full blur-[90px]"
              style={{ backgroundColor: auraBg }}
            />
            <div
              ref={albumRef}
              className="relative aspect-square h-full max-h-[15.5rem] max-w-full rounded-[1.75rem] will-change-transform"
            >
              <div
                aria-hidden
                className="absolute -inset-[3px] rounded-[2rem] opacity-70 blur-[1px]"
                style={{ background: frameBg }}
              />
              {track.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={hiResCover(track.cover)}
                  alt={track.album}
                  className="relative h-full w-full rounded-[1.75rem] object-cover shadow-2xl"
                />
              ) : (
                <div className="relative h-full w-full rounded-[1.75rem] gradient-violet opacity-90 shadow-2xl" />
              )}
            </div>
          </div>

          <div className="w-full max-w-2xl flex-shrink-0">
            <div className="mb-2 text-center md:mb-3">
              <div className="flex items-center justify-center gap-3">
                <TrackTitle
                  track={track}
                  onNavigate={onClose}
                  className="min-w-0 truncate text-2xl font-extrabold tracking-tight hover:underline md:text-4xl"
                />
                <LikeButton track={track} />
              </div>
              <ArtistLinks
                track={track}
                onNavigate={onClose}
                className="mt-1 block truncate text-sm text-muted md:text-base"
                linkClassName="hover:text-foreground hover:underline"
              />
            </div>

            <SeekBar
              currentTime={currentTime}
              duration={duration}
              onSeek={onSeek}
            />
            <TransportRow
              isPlaying={isPlaying}
              shuffle={shuffle}
              repeat={repeat}
              repeatGlyph={RepeatGlyph}
              onToggle={onToggle}
              onNext={onNext}
              onPrev={onPrev}
              onToggleShuffle={onToggleShuffle}
              onCycleRepeat={onCycleRepeat}
            />
            <VolumeRow
              muted={muted}
              volume={volume}
              onToggleMute={onToggleMute}
              onVolume={onVolume}
            />
          </div>
        </div>

        {/* Audio-reactive visualizer — pinned flush to the panel's bottom edge,
            matching its corner radius so it reaches the box on every side. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 overflow-hidden rounded-b-[1.75rem] md:rounded-b-[2.25rem]"
        >
          <Visualizer
            isPlaying={isPlaying}
            className="block h-14 w-full md:h-24"
            colors={palette?.gradient}
            glow={palette ? palette.primary : undefined}
          />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- similar tracks ----------------------------- */

function SimilarTracksPanel({
  seedId,
  onClose,
}: {
  seedId: string | number;
  onClose: () => void;
}) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["similar-tracks", seedId],
    queryFn: () => api.radio(String(seedId)),
    enabled: !!seedId,
    staleTime: 15 * 60_000,
  });

  const tracks = data ?? [];

  return (
    <div className="mt-6 flex min-h-0 flex-1 flex-col lg:mt-0">
      <span className="mb-4 flex-shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted">
        Ähnliche Titel
      </span>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-area rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
        {isLoading && (
          <p className="px-2 py-4 text-sm text-muted">
            Ähnliche Titel werden geladen…
          </p>
        )}
        {isError && (
          <p className="px-2 py-4 text-sm text-muted">
            Ähnliche Titel konnten nicht geladen werden.
          </p>
        )}
        {!isLoading && !isError && tracks.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted">
            Für diesen Titel wurden keine ähnlichen Songs gefunden.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {tracks.map((t, i) => (
            <li
              key={`${t.id}-${i}`}
              className="group flex items-center gap-3 rounded-2xl px-3 py-2 transition hover:bg-white/5"
            >
              <button
                type="button"
                onClick={() => {
                  playQueue(tracks, i);
                  onClose();
                }}
                aria-label={`${t.title} abspielen`}
                className="relative flex-shrink-0 group/cover"
              >
                {t.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.cover}
                    alt=""
                    className="h-12 w-12 rounded-xl object-cover shadow"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-xl gradient-violet opacity-80" />
                )}
                <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/50 opacity-0 transition group-hover/cover:opacity-100">
                  <PlayIcon width={18} height={18} className="text-white" />
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <TrackTitle
                  track={t}
                  onNavigate={onClose}
                  className="block truncate text-sm font-semibold hover:underline"
                />
                <ArtistLinks
                  track={t}
                  onNavigate={onClose}
                  className="block truncate text-xs text-muted"
                  linkClassName="hover:text-foreground hover:underline"
                />
              </div>
              <button
                type="button"
                onClick={() => addToQueue(t)}
                aria-label="Zur Warteschlange hinzufügen"
                title="Zur Warteschlange hinzufügen"
                className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-muted opacity-0 transition hover:bg-white/10 hover:text-foreground group-hover:opacity-100"
              >
                <PlusIcon width={18} height={18} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* -------------------------------- lyrics ---------------------------------- */

function LyricsPanel({
  artist,
  title,
  trackId,
  currentTime,
  onSeek,
}: {
  artist: string;
  title: string;
  trackId: number | string;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const { lines, active, hasTimedLines, isLoading, isAiGenerated } = useLyrics(
    artist,
    title,
    trackId,
    currentTime,
  );

  useEffect(() => {
    const el = activeRef.current;
    const container = scrollRef.current;
    if (!el || !container) return;
    const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top, behavior: "smooth" });
  }, [active]);

  // Desktop-only — the mobile fullscreen uses <CompactLyrics> instead.
  return (
    <div className="hidden min-h-0 flex-col lg:flex">
      <span className="mb-4 flex flex-shrink-0 items-center gap-2 text-foreground/90">
        <MusicNoteIcon width={16} height={16} />
        <span className="text-xs font-semibold uppercase tracking-widest">
          Lyrics
        </span>
        {isAiGenerated && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
            ✦ AI
          </span>
        )}
      </span>
      {lines.length > 0 ? (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto no-scrollbar py-[35vh] pr-2 text-center"
        >
          {lines.map((line, i) => {
            const isActive = i === active;
            const dist = Math.abs(i - active);
            return (
              <button
                key={i}
                type="button"
                ref={isActive ? activeRef : undefined}
                onClick={() => hasTimedLines && onSeek(line.t)}
                disabled={!hasTimedLines}
                style={
                  isActive
                    ? undefined
                    : { opacity: dist === 1 ? 0.6 : dist === 2 ? 0.45 : 0.3 }
                }
                className={`block w-full py-2 text-3xl font-bold leading-snug transition-all duration-300 ${
                  isActive
                    ? "text-[color:var(--accent-soft)]"
                    : "text-muted hover:opacity-90"
                }`}
              >
                {line.text || "♪"}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-muted">{isLoading ? "Lädt…" : "Kein Songtext"}</p>
        </div>
      )}
    </div>
  );
}
