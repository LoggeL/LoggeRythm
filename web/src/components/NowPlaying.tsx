"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePlayerStore, currentTrack } from "@/store/player";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import LikeButton from "@/components/LikeButton";
import Visualizer, { RadialVisualizer } from "@/components/Visualizer";
import EqualizerBars from "@/components/EqualizerBars";
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
} from "@/components/icons";

type NowPlayingTab = "playing" | "lyrics" | "similar";

export default function NowPlaying({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<NowPlayingTab>("playing");
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

  if (!track) return null;
  const RepeatGlyph = repeat === "one" ? RepeatOneIcon : RepeatIcon;
  const isPlayingView = tab === "playing";

  return (
    <div className="animate-in fixed inset-0 z-[80] flex h-dvh flex-col overflow-hidden bg-background px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] md:p-8">
      {/* Ambient backdrop from the cover art */}
      {track.cover && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={track.cover}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-30"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-background/80"
          />
        </>
      )}
      <div className="relative flex flex-shrink-0 justify-between items-center mb-3 md:mb-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="text-muted hover:text-foreground p-2 -ml-2 md:ml-0"
        >
          <ChevronDownIcon width={24} height={24} />
        </button>
        <span className="text-base font-extrabold tracking-tight">
          <span className="text-foreground">Spoti</span>
          <span className="text-accent">Frei</span>
        </span>
        <span className="w-10" />
      </div>

      <div className="relative mx-auto mb-3 flex max-w-full flex-shrink-0 overflow-x-auto rounded-2xl bg-white/5 p-1 ring-1 ring-white/10 no-scrollbar md:mb-6">
        {[
          ["playing", "Jetzt läuft"],
          ["lyrics", "Songtext"],
          ["similar", "Ähnliche Titel"],
        ].map(([key, label]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key as NowPlayingTab)}
              className={`min-w-24 rounded-xl px-3 py-2 text-xs font-semibold transition sm:min-w-28 sm:px-4 sm:text-sm ${
                active
                  ? "bg-accent text-white shadow-lg shadow-accent/20"
                  : "text-muted hover:text-foreground hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        className={`relative flex-1 min-h-0 lg:grid lg:gap-8 xl:gap-10 flex flex-col ${
          isPlayingView
            ? "lg:grid-cols-[minmax(0,2.2fr)_0.9fr]"
            : "lg:grid-cols-[1.05fr_1.2fr_0.9fr]"
        }`}
      >
        {/* Left: cover, title, transport */}
        <div
          className={`flex-col min-h-0 lg:overflow-y-auto no-scrollbar ${
            isPlayingView ? "hidden" : "flex"
          }`}
        >
          <div className="flex-1 flex flex-col items-center justify-center gap-8 min-h-0">
            {track.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={track.cover}
                alt={track.album}
                className="w-full max-w-md xl:max-w-lg aspect-square rounded-[1.75rem] object-cover shadow-2xl glow-strong"
              />
            ) : (
              <div className="w-full max-w-md xl:max-w-lg aspect-square rounded-[1.75rem] gradient-violet opacity-80 glow-strong" />
            )}

            <div className="w-full max-w-md text-center">
              <div className="flex items-center justify-center gap-3">
                <h2 className="text-3xl font-extrabold truncate">{track.title}</h2>
                <LikeButton track={track} />
              </div>
              <p className="text-muted mt-1">
                {track.artist_id ? (
                  <Link
                    href={`/artist/${track.artist_id}`}
                    onClick={onClose}
                    className="hover:underline hover:text-foreground"
                  >
                    {track.artist}
                  </Link>
                ) : (
                  track.artist
                )}
              </p>
            </div>
          </div>

          <div className="w-full max-w-md mx-auto mt-8">
        <Visualizer isPlaying={isPlaying} className="w-full h-16 mb-5" />
        <div className="flex items-center gap-2 w-full">
          <span className="text-xs text-muted w-10 text-right tabular-nums">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!duration}
            className="flex-1"
            aria-label="Fortschritt"
          />
          <span className="text-xs text-muted w-10 tabular-nums">
            {formatTime(duration)}
          </span>
        </div>

        <div className="flex items-center justify-center gap-6 mt-4">
          <button
            type="button"
            onClick={toggleShuffle}
            aria-label="Zufallswiedergabe"
            className={shuffle ? "text-accent" : "text-muted hover:text-foreground"}
          >
            <ShuffleIcon width={22} height={22} />
          </button>
          <button
            type="button"
            onClick={prev}
            aria-label="Vorheriger Titel"
            className="text-muted hover:text-foreground"
          >
            <PrevIcon width={30} height={30} />
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={isPlaying ? "Pause" : "Abspielen"}
            className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-105 transition"
          >
            {isPlaying ? (
              <PauseIcon width={30} height={30} />
            ) : (
              <PlayIcon width={30} height={30} />
            )}
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Nächster Titel"
            className="text-muted hover:text-foreground"
          >
            <NextIcon width={30} height={30} />
          </button>
          <button
            type="button"
            onClick={cycleRepeat}
            aria-label="Wiederholen"
            className={repeat !== "off" ? "text-accent" : "text-muted hover:text-foreground"}
          >
            <RepeatGlyph width={22} height={22} />
          </button>
        </div>

        <div className="flex items-center gap-2 mt-6 justify-center">
          <button
            type="button"
            onClick={toggleMute}
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
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-40"
            aria-label="Lautstärke"
          />
          </div>
        </div>
        </div>

        {tab === "similar" ? (
          <SimilarTracksPanel seedId={track.id} onClose={onClose} />
        ) : tab === "playing" ? (
          <EpicPlayingPanel
            track={track}
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
          <LyricsPanel
            artist={track.artist}
            title={track.title}
            trackId={track.id}
            currentTime={currentTime}
            onSeek={seek}
          />
        )}

        {/* Right: queue (desktop only — mockup's third column) */}
        <NowPlayingQueue />
      </div>
    </div>
  );
}

function NowPlayingQueue() {
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

  const renderItem = ({ t, i }: { t: (typeof upcoming)[number]["t"]; i: number }) => (
    <li key={`${t.id}-${i}`}>
      <button
        type="button"
        onClick={() => jumpTo(i)}
        className="group flex items-center gap-3 w-full px-2 py-2 rounded-lg text-left transition hover:bg-white/5"
      >
        {t.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={t.cover}
            alt=""
            className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-lg gradient-violet opacity-80 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{t.title}</div>
          <div className="truncate text-xs text-muted">{t.artist}</div>
        </div>
        <span className="text-xs text-muted tabular-nums">
          {formatTime(t.duration_sec)}
        </span>
      </button>
    </li>
  );

  return (
    <div className="hidden lg:flex flex-col min-h-0">
      <div className="flex-shrink-0 flex items-center justify-between mb-4">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Warteschlange
        </span>
        {upcoming.length > 0 && (
          <button
            type="button"
            onClick={clearQueue}
            className="px-3 py-1 rounded-full bg-white/5 text-muted hover:text-foreground hover:bg-white/10 text-xs font-semibold press"
          >
            Leeren
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-area pr-1">
        {cur && (
          <>
            <p className="text-[11px] uppercase tracking-wide text-muted mb-1">
              Aktueller Titel
            </p>
            <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-accent/10 ring-1 ring-accent/30 mb-4">
              {cur.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cur.cover}
                  alt=""
                  className="w-11 h-11 rounded-lg object-cover shadow"
                />
              ) : (
                <div className="w-11 h-11 rounded-lg gradient-violet opacity-80" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-accent font-medium">
                  {cur.title}
                </div>
                <div className="truncate text-xs text-muted">{cur.artist}</div>
              </div>
              {isPlaying && (
                <EqualizerBars height={16} barClassName="bg-accent" />
              )}
            </div>
          </>
        )}

        {userUpcoming.length > 0 && (
          <>
            <p className="text-[11px] uppercase tracking-wide text-muted mb-1">
              Als Nächstes in der Warteschlange
            </p>
            <ul className="flex flex-col mb-4">{userUpcoming.map(renderItem)}</ul>
          </>
        )}

        {contextUpcoming.length > 0 && (
          <>
            <p className="text-[11px] uppercase tracking-wide text-muted mb-1">
              {queueContext ? `Als Nächstes: ${queueContext}` : "Als Nächstes"}
            </p>
            <ul className="flex flex-col">{contextUpcoming.map(renderItem)}</ul>
          </>
        )}

        {!cur && upcoming.length === 0 && (
          <p className="text-sm text-muted px-2 py-4">
            Die Warteschlange ist leer.
          </p>
        )}
      </div>
    </div>
  );
}

function EpicPlayingPanel({
  track,
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
  return (
    <div className="min-h-0 flex flex-1 flex-col lg:mt-0">
      <span className="sr-only lg:not-sr-only lg:flex-shrink-0 lg:text-[11px] lg:font-semibold lg:uppercase lg:tracking-widest lg:text-muted lg:mb-4">
        Jetzt läuft
      </span>
      <div className="relative flex-1 min-h-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.045] backdrop-blur-2xl shadow-2xl shadow-black/30 md:rounded-[2rem]">
        {track.cover && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={track.cover}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-3xl"
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(124,92,255,0.22),transparent_38%),linear-gradient(to_bottom,rgba(11,11,18,0.18),rgba(11,11,18,0.9))]"
            />
          </>
        )}

        <div className="relative z-10 flex h-full min-h-0 flex-col items-center justify-between gap-4 p-4 md:gap-7 md:p-10">
          <div className="relative grid w-full flex-1 min-h-0 place-items-center">
            <div
              aria-hidden
              className="absolute inset-x-4 top-1/2 h-48 -translate-y-1/2 rounded-full bg-accent/20 blur-3xl"
            />
            <div className="relative grid aspect-square w-[min(58vw,32vh,18rem)] place-items-center md:w-[min(36vh,32rem)]">
              <RadialVisualizer
                isPlaying={isPlaying}
                className="pointer-events-none absolute inset-0 z-0 h-full w-full"
              />
              <div className="relative flex aspect-square w-[82%] items-center justify-center rounded-full border border-white/10 bg-black/30 p-[8.5%] shadow-[0_0_80px_rgba(124,92,255,0.35)]">
                <div
                  aria-hidden
                  className="absolute inset-[8%] z-10 rounded-full border border-accent/25"
                />
                <div
                  aria-hidden
                  className="absolute inset-[18%] z-0 rounded-full bg-accent/15 blur-2xl"
                />
                {track.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={track.cover}
                    alt={track.album}
                    className="relative z-20 h-full w-full rounded-full object-cover shadow-2xl"
                  />
                ) : (
                  <div className="relative z-20 h-full w-full rounded-full gradient-violet opacity-90 shadow-2xl" />
                )}
              </div>
            </div>
          </div>

          <div className="w-full max-w-3xl">
            <div className="mb-3 text-center md:mb-5">
              <div className="flex items-center justify-center gap-3">
                <h2 className="min-w-0 truncate text-xl font-extrabold md:text-5xl">
                  {track.title}
                </h2>
                <LikeButton track={track} />
              </div>
              <p className="mt-1 truncate text-sm text-muted md:mt-2 md:text-lg">{track.artist}</p>
            </div>

            <div className="flex items-center gap-2 w-full">
              <span className="text-xs text-muted w-10 text-right tabular-nums">
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
                aria-label="Fortschritt"
              />
              <span className="text-xs text-muted w-10 tabular-nums">
                {formatTime(duration)}
              </span>
            </div>

            <div className="mt-4 flex items-center justify-center gap-4 md:mt-5 md:gap-6">
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
                className="text-muted hover:text-foreground"
              >
                <PrevIcon width={30} height={30} />
              </button>
              <button
                type="button"
                onClick={onToggle}
                aria-label={isPlaying ? "Pause" : "Abspielen"}
                className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-105 transition md:h-16 md:w-16"
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
                className="text-muted hover:text-foreground"
              >
                <NextIcon width={30} height={30} />
              </button>
              <button
                type="button"
                onClick={onCycleRepeat}
                aria-label="Wiederholen"
                className={repeat !== "off" ? "text-accent" : "text-muted hover:text-foreground"}
              >
                <RepeatGlyph width={22} height={22} />
              </button>
            </div>

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
                className="w-40"
                aria-label="Lautstärke"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
    <div className="min-h-0 mt-8 lg:mt-0 flex flex-col">
      <span className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted mb-4">
        Ähnliche Titel
      </span>
      <div className="flex-1 min-h-0 rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-2xl shadow-black/20 p-5 overflow-y-auto scroll-area">
        {isLoading && (
          <p className="text-sm text-muted px-2 py-4">Ähnliche Titel werden geladen…</p>
        )}
        {isError && (
          <p className="text-sm text-muted px-2 py-4">
            Ähnliche Titel konnten nicht geladen werden.
          </p>
        )}
        {!isLoading && !isError && tracks.length === 0 && (
          <p className="text-sm text-muted px-2 py-4">
            Für diesen Titel wurden keine ähnlichen Songs gefunden.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {tracks.map((t, i) => (
            <li key={`${t.id}-${i}`}>
              <div className="group flex items-center gap-3 rounded-2xl px-3 py-2 transition hover:bg-white/5">
                <button
                  type="button"
                  onClick={() => {
                    playQueue(tracks, i);
                    onClose();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  {t.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.cover}
                      alt=""
                      className="h-12 w-12 flex-shrink-0 rounded-xl object-cover shadow"
                    />
                  ) : (
                    <div className="h-12 w-12 flex-shrink-0 rounded-xl gradient-violet opacity-80" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {t.title}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {t.artist}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => addToQueue(t)}
                  className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-muted opacity-0 transition hover:bg-white/10 hover:text-foreground group-hover:opacity-100"
                >
                  Hinzufügen
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

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

  const { data, isLoading } = useQuery({
    queryKey: ["lyrics", trackId],
    queryFn: () => api.lyrics(artist, title, String(trackId)),
    enabled: !!trackId,
    staleTime: 3600_000,
    retry: false,
  });

  const lines = data?.lines ?? [];
  const isAiGenerated = !!data?.ai_generated;
  const hasTimedLines = lines.some((line) => typeof line.t === "number");

  // Active line = last line whose timestamp has passed.
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!hasTimedLines) break;
    if (lines[i].t <= currentTime + 0.15) active = i;
    else break;
  }

  useEffect(() => {
    const el = activeRef.current;
    const container = scrollRef.current;
    if (!el || !container) return;
    const top =
      el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top, behavior: "smooth" });
  }, [active]);

  return (
    <div className="min-h-0 mt-8 lg:mt-0 flex flex-col">
      <span className="hidden lg:flex flex-shrink-0 items-center text-[11px] font-semibold uppercase tracking-widest text-muted mb-4">
        Songtext
        {isAiGenerated && (
          <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
            ✦ AI
          </span>
        )}
      </span>
      {lines.length > 0 ? (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto no-scrollbar py-[40vh] lg:py-[35vh] pr-2"
        >
          {lines.map((line, i) => {
            const isActive = i === active;
            return (
              <button
                key={i}
                type="button"
                ref={isActive ? activeRef : undefined}
                onClick={() => hasTimedLines && onSeek(line.t)}
                disabled={!hasTimedLines}
                className={`block w-full text-left py-2 text-2xl sm:text-3xl font-bold leading-snug transition-all duration-300 ${
                  isActive
                    ? "text-foreground opacity-100"
                    : "text-muted opacity-50 hover:opacity-80"
                }`}
              >
                {line.text || "♪"}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <p className="text-muted">
            {isLoading ? "Lädt…" : "Kein Songtext"}
          </p>
        </div>
      )}
    </div>
  );
}
