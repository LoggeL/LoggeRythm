"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { QRCodeSVG } from "qrcode.react";
import { usePlayerStore } from "@/store/player";
import { useCoverColors } from "@/hooks/useCoverColors";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useLivePlaybackTime } from "@/hooks/useLivePlaybackTime";
import { useLocalJson } from "@/hooks/useLocalJson";
import { useLyrics } from "@/hooks/useLyrics";
import { useVisualizerScene } from "@/hooks/useVisualizerScene";
import { hiResCover } from "@/lib/cover";
import { fullscreenTheme } from "@/lib/fullscreenTheme";
import { trackArtistLabel } from "@/lib/trackArtists";
import {
  INITIAL_VISUALIZER_PREFERENCES,
  VISUALIZER_PREFERENCES_KEY,
  validateVisualizerPreferences,
  type VisualizerPreferences,
} from "@/lib/visualizerScenes";
import Avatar from "@/components/Avatar";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import FullscreenVisualizer from "@/components/FullscreenVisualizer";
import KaraokeLine from "@/components/KaraokeLine";
import SceneVisualizer from "@/components/SceneVisualizer";
import { CloseIcon, NextIcon, PauseIcon, PlayIcon } from "@/components/icons";
import type { PartyReaction, PartyState, PartyTrack } from "@/types";

export const PARTY_REACTION_EMOJIS = ["🔥", "❤️", "🎉", "🙌", "😮", "💃"] as const;

/** Deterministic horizontal lane in [14%, 85%] derived from a string reaction ID. */
export function reactionLeftPct(reactionId: string): number {
  let hash = 0;
  for (let i = 0; i < reactionId.length; i++) {
    hash = (hash * 31 + reactionId.charCodeAt(i)) >>> 0;
  }
  return 14 + (hash % 72);
}

interface FloatingReaction {
  uid: string;
  emoji: string;
  sender: string;
  leftPct: number;
}

function partyTrackToDisplay(pt: PartyTrack) {
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
 * Full-bleed Living-Room Party-Screen Kiosk overlay for `/party/[code]`:
 * audio-reactive WebGL visualizer + oversized cover + live word-by-word lyrics
 * + "Hinzugefügt von" attribution + Up Next ticker + permanent corner QR code
 * + live floating emoji reactions from SSE.
 */
export default function PartyScreenKiosk({
  party,
  shareUrl,
  canControl,
  onTogglePlayback,
  onNext,
  onReact,
  onClose,
}: {
  party: PartyState;
  shareUrl: string;
  canControl: boolean;
  onTogglePlayback: () => void;
  onNext: () => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const artworkRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, rootRef, onClose);

  const currentItem: PartyTrack | null =
    party.current_index >= 0 && party.current_index < party.tracks.length
      ? party.tracks[party.current_index]
      : null;
  const track = useMemo(
    () => (currentItem ? partyTrackToDisplay(currentItem) : null),
    [currentItem],
  );
  const upNext = useMemo(
    () =>
      party.current_index >= 0
        ? party.tracks.slice(party.current_index + 1, party.current_index + 4)
        : party.tracks.slice(0, 3),
    [party.tracks, party.current_index],
  );

  const liveTime = useLivePlaybackTime(Boolean(track));
  const isPlaying = usePlayerStore((s) => s.isPlaying) || party.is_playing;
  const palette = useCoverColors(track?.cover);

  const [storedPreferences] = useLocalJson<VisualizerPreferences>(
    VISUALIZER_PREFERENCES_KEY,
    INITIAL_VISUALIZER_PREFERENCES,
  );
  const preferences = validateVisualizerPreferences(storedPreferences);
  const sceneChoice = useVisualizerScene({
    track,
    preference: preferences.scene,
    listening: preferences.enabled && isPlaying,
  });

  const lyrics = useLyrics(
    track?.artist ?? "",
    track?.title ?? "",
    track?.id ?? "",
    liveTime,
    { album: track?.album, duration_sec: track?.duration_sec },
  );

  // Ephemeral floating reactions driven by `party.latest_reaction` SSE updates.
  // Timers live in a ref Set cleared only on unmount so rapid reactions never
  // cancel each other's cleanup timers.
  const [floating, setFloating] = useState<FloatingReaction[]>([]);
  const lastReactionId = useRef<string | null>(party.latest_reaction?.id ?? null);
  const reactionTimersRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const timers = reactionTimersRef.current;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const latest: PartyReaction | null | undefined = party.latest_reaction;
    if (!latest || latest.id === lastReactionId.current) return;
    lastReactionId.current = latest.id;
    const uid = `${latest.id}-${Date.now()}`;
    const leftPct = reactionLeftPct(latest.id);
    const timers = reactionTimersRef.current;
    const spawnTimer = window.setTimeout(() => {
      timers.delete(spawnTimer);
      setFloating((prev) => [
        ...prev.slice(-10),
        { uid, emoji: latest.emoji, sender: latest.member_name, leftPct },
      ]);
    }, 0);
    timers.add(spawnTimer);
    const cleanupTimer = window.setTimeout(() => {
      timers.delete(cleanupTimer);
      setFloating((prev) => prev.filter((item) => item.uid !== uid));
    }, 3400);
    timers.add(cleanupTimer);
  }, [party.latest_reaction]);

  // Enter browser fullscreen best-effort when opening Party-Screen.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, []);

  const activeIdx = lyrics.active;
  const visibleLyricLines = useMemo(() => {
    if (lyrics.instrumental || !lyrics.lines.length || !lyrics.hasTimedLines) return [];
    const center = activeIdx >= 0 ? activeIdx : 0;
    const start = Math.max(0, center - 1);
    const end = Math.min(lyrics.lines.length, center + 3);
    return lyrics.lines.slice(start, end).map((line, offset) => ({
      line,
      index: start + offset,
    }));
  }, [lyrics.instrumental, lyrics.lines, lyrics.hasTimedLines, activeIdx]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Party-Screen Kiosk"
      style={
        {
          "--muted": "rgb(244 240 230 / 0.8)",
          "--subtle": "rgb(244 240 230 / 0.64)",
          ...fullscreenTheme(palette),
        } as CSSProperties
      }
      className="fixed inset-0 z-[110] flex h-dvh flex-col overflow-hidden bg-backdrop text-foreground"
    >
      {track?.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hiResCover(track.cover)}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-45 blur-3xl saturate-150"
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_75%_at_50%_35%,rgb(10_11_13/0.25),rgb(10_11_13/0.86))]"
      />
      {preferences.enabled &&
        track &&
        (sceneChoice.scene === "aura" ? (
          <FullscreenVisualizer
            isPlaying={isPlaying}
            anchorRef={artworkRef}
            palette={palette}
            className="pointer-events-none absolute inset-0 block h-full w-full"
          />
        ) : (
          <SceneVisualizer
            scene={sceneChoice.scene}
            isPlaying={isPlaying}
            anchorRef={artworkRef}
            palette={palette}
            trackId={track.id}
            className="pointer-events-none absolute inset-0 block h-full w-full"
          />
        ))}

      {/* Live floating reactions */}
      <div aria-live="polite" className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        {floating.map((item) => (
          <div
            key={item.uid}
            style={{ left: `${item.leftPct}%` }}
            className="animate-[sheetUp_.45s_var(--ease-out)] absolute bottom-28 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/20 bg-[#0f0e11]/88 px-3.5 py-1.5 shadow-[0_14px_34px_rgb(0_0_0/0.72)] backdrop-blur-xl"
          >
            <span className="text-2xl leading-none">{item.emoji}</span>
            <span className="text-xs font-semibold text-foreground [text-shadow:0_1px_6px_rgb(0_0_0/0.8)]">{item.sender}</span>
          </div>
        ))}
      </div>

      {/* Top kiosk header */}
      <header className="relative z-10 flex items-center justify-between gap-4 border-b border-white/[0.08] bg-gradient-to-b from-[#0f0e11]/86 via-[#0f0e11]/68 to-[#0f0e11]/38 px-6 py-4 backdrop-blur-xl lg:px-10">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/45 bg-[#0f0e11]/84 px-3.5 py-1 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-accent-soft shadow-[0_6px_20px_rgb(0_0_0/0.45)]">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent animate-pulse" />
            Party-Screen · {party.name || party.code}
          </span>
          <span className="label-mono hidden rounded-full border border-white/14 bg-[#0f0e11]/75 px-3 py-1 text-foreground/88 sm:inline">
            {party.members.length} {party.members.length === 1 ? "Person" : "Personen"}
          </span>
          {party.auto_dj && (
            <span className="label-mono rounded-full border border-white/16 bg-[#0f0e11]/80 px-2.5 py-1 text-[10px] text-foreground">
              Auto-DJ
            </span>
          )}
        </div>
        <button
          data-dialog-autofocus
          type="button"
          onClick={onClose}
          className="action-secondary min-h-10 gap-2 border-white/18 bg-[#0f0e11]/84 px-4 text-xs shadow-[0_6px_18px_rgb(0_0_0/0.45)] backdrop-blur-md hover:bg-[#0f0e11]/95"
        >
          <CloseIcon width={16} height={16} />
          Schließen
        </button>
      </header>

      {/* Main kiosk stage: cover + live lyrics */}
      <div className="relative z-10 grid min-h-0 flex-1 items-center gap-8 px-6 py-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14 lg:px-12">
        <div className="flex min-w-0 flex-col items-center text-center lg:items-start lg:text-left">
          <div ref={artworkRef} className="cover-shadow relative aspect-square w-full max-w-[18rem] overflow-hidden rounded-[var(--radius-panel)] sm:max-w-[22rem] lg:max-w-[26rem]">
            {track?.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={hiResCover(track.cover)}
                alt={track.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <CoverPlaceholder className="h-full w-full" />
            )}
          </div>
          {track && currentItem ? (
            <div className="mt-5 w-full max-w-[26rem] min-w-0 rounded-2xl border border-white/12 bg-[#0f0e11]/74 px-5 py-4 shadow-[0_18px_44px_rgb(0_0_0/0.52)] backdrop-blur-xl">
              <h1 className="font-display line-clamp-2 text-[clamp(1.75rem,3.6vw,3.25rem)] font-extrabold leading-[1.04] tracking-[-0.04em] text-foreground [text-shadow:0_2px_14px_rgb(0_0_0/0.82)]">
                {track.title}
              </h1>
              <p className="mt-2 truncate text-lg font-medium text-foreground/85 [text-shadow:0_1px_10px_rgb(0_0_0/0.78)] lg:text-xl">
                {trackArtistLabel(track)}
              </p>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/16 bg-[#0f0e11]/85 py-1 pl-1.5 pr-3.5 text-xs shadow-[0_4px_14px_rgb(0_0_0/0.4)] backdrop-blur-md">
                <Avatar src={currentItem.added_by_avatar_url} name={currentItem.added_by} size={22} />
                <span className="text-foreground/75">Hinzugefügt von</span>
                <span className="font-semibold text-foreground">{currentItem.added_by}</span>
              </div>
            </div>
          ) : (
            <p className="mt-6 max-w-md rounded-2xl border border-white/12 bg-[#0f0e11]/76 px-5 py-3.5 text-base font-medium text-foreground/90 shadow-[0_14px_36px_rgb(0_0_0/0.45)] backdrop-blur-xl">
              Noch kein Song in der Jam – scanne den QR-Code und füge Titel hinzu!
            </p>
          )}
        </div>

        {/* Live karaoke lyrics column */}
        <div className="hidden min-h-0 flex-col justify-center gap-3.5 overflow-x-hidden rounded-[var(--radius-panel)] border border-white/12 bg-[#0f0e11]/70 px-7 py-7 shadow-[0_20px_50px_rgb(0_0_0/0.48)] backdrop-blur-xl lg:flex">
          {lyrics.instrumental ? (
            <p className="font-display text-3xl font-extrabold tracking-tight text-accent-soft [text-shadow:0_2px_14px_rgb(0_0_0/0.8)]">
              ♪ Instrumental
            </p>
          ) : visibleLyricLines.length > 0 ? (
            visibleLyricLines.map(({ line, index }) => {
              const isActive = index === activeIdx;
              const isPast = activeIdx >= 0 && index < activeIdx;
              return (
                <p
                  key={index}
                  className={`font-display rounded-xl text-[clamp(1.6rem,2.8vw,2.9rem)] font-extrabold leading-[1.14] tracking-[-0.03em] transition-[color,background-color] duration-300 ${
                    isActive
                      ? "-mx-3 bg-white/[0.07] px-3 py-1.5 text-foreground ring-1 ring-white/[0.09] [text-shadow:0_2px_16px_rgb(0_0_0/0.88)]"
                      : isPast
                        ? "text-foreground/50 [text-shadow:0_1px_10px_rgb(0_0_0/0.75)]"
                        : "text-foreground/70 [text-shadow:0_1px_10px_rgb(0_0_0/0.78)]"
                  }`}
                >
                  <span
                    className={`block origin-left transition-transform duration-300 motion-reduce:transition-none ${
                      isActive ? "max-w-[97%] scale-[1.02]" : ""
                    }`}
                  >
                    <KaraokeLine
                      line={line}
                      isActive={isActive}
                      isPast={isPast}
                      currentTime={liveTime}
                    />
                  </span>
                </p>
              );
            })
          ) : lyrics.isLoading ? (
            <p className="label-mono text-sm text-foreground/80 [text-shadow:0_1px_8px_rgb(0_0_0/0.75)]">
              Songtext wird geladen…
            </p>
          ) : null}
        </div>
      </div>

      {/* Bottom kiosk dock: Up Next ticker + reactions/controls + permanent corner QR */}
      <footer className="relative z-10 flex flex-wrap items-end justify-between gap-4 border-t border-white/12 bg-[#0f0e11]/86 px-6 py-4 shadow-[0_-14px_40px_rgb(0_0_0/0.52)] backdrop-blur-xl lg:px-10">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {canControl && (
              <>
                <button
                  type="button"
                  onClick={onTogglePlayback}
                  aria-label={party.is_playing ? "Pause" : "Abspielen"}
                  className="play-fab h-11 w-11"
                >
                  {party.is_playing ? <PauseIcon width={20} height={20} /> : <PlayIcon width={20} height={20} />}
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  aria-label="Nächster Titel"
                  className="action-icon h-11 w-11 border border-white/15 bg-[#0f0e11]/72 text-foreground hover:bg-[#0f0e11]/92"
                >
                  <NextIcon width={20} height={20} />
                </button>
              </>
            )}
            <div className="flex items-center gap-1 rounded-full border border-white/15 bg-[#0f0e11]/78 px-2 py-1 backdrop-blur-md" role="group" aria-label="Reaktion senden">
              {PARTY_REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact(emoji)}
                  aria-label={`Reaktion ${emoji} senden`}
                  className="grid h-9 w-9 place-items-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-white/12 active:scale-95"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {upNext.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
              <span className="label-mono rounded-full border border-accent/35 bg-accent/15 px-2.5 py-0.5 text-[10px] font-semibold text-accent-soft">
                Als Nächstes
              </span>
              {upNext.map((item) => (
                <span key={item.id} className="truncate text-foreground/95 [text-shadow:0_1px_6px_rgb(0_0_0/0.75)]">
                  <strong className="font-semibold text-foreground">{item.title}</strong>{" "}
                  <span className="text-foreground/78">· {item.artist} ({item.added_by})</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Permanent corner QR code for guests */}
        <div className="flex shrink-0 items-center gap-3.5 rounded-[var(--radius-card)] border border-white/18 bg-[#0f0e11]/94 p-2.5 pr-4 shadow-[0_16px_38px_rgb(0_0_0/0.65)] backdrop-blur-xl">
          <div className="rounded-lg bg-white p-1.5">
            {shareUrl ? (
              <QRCodeSVG value={shareUrl} size={76} level="M" bgColor="#ffffff" fgColor="#0a0b0d" />
            ) : (
              <div className="h-[76px] w-[76px]" />
            )}
          </div>
          <div>
            <p className="label-mono text-[10px] text-foreground/82">Scannen & Songs hinzufügen</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-[0.12em] text-accent-soft tabular-nums [text-shadow:0_2px_12px_rgb(0_0_0/0.6)]">
              {party.code}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
