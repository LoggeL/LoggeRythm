"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePlayerStore, currentTrack } from "@/store/player";
import { useCoverColors } from "@/hooks/useCoverColors";
import { useLyrics } from "@/hooks/useLyrics";
import { useLivePlaybackTime } from "@/hooks/useLivePlaybackTime";
import { trackArtistLabel } from "@/lib/trackArtists";
import { formatTime } from "@/lib/format";
import { toast } from "@/store/toast";
import LikeButton from "@/components/LikeButton";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { NextIcon, PauseIcon, PipIcon, PlayIcon, PrevIcon, SpinnerIcon } from "@/components/icons";

interface DocumentPictureInPictureApi {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
  window?: Window | null;
}

type WindowWithDocumentPiP = Window & {
  documentPictureInPicture?: DocumentPictureInPictureApi;
};

const subscribeNever = () => () => {};
const isSupportedClient = () =>
  typeof window !== "undefined" &&
  typeof (window as WindowWithDocumentPiP).documentPictureInPicture?.requestWindow === "function";
const isSupportedServer = () => false;

function copyStylesToPip(targetDoc: Document): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const cssText = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      const style = targetDoc.createElement("style");
      style.textContent = cssText;
      targetDoc.head.appendChild(style);
    } catch (cause) {
      if (sheet.href) {
        const link = targetDoc.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        targetDoc.head.appendChild(link);
      } else {
        throw cause;
      }
    }
  }
  targetDoc.documentElement.className = document.documentElement.className;
  targetDoc.body.className = "h-full bg-backdrop text-foreground overflow-hidden select-none";
}

function PipMiniDeck() {
  const track = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const duration = usePlayerStore((s) => s.duration);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const liveTime = useLivePlaybackTime(Boolean(track));
  const palette = useCoverColors(track?.cover);
  const lyrics = useLyrics(track?.artist ?? "", track?.title ?? "", track?.id ?? "", liveTime, {
    album: track?.album,
    duration_sec: track?.duration_sec,
  });

  const activeLine =
    lyrics.lines.length > 0 && lyrics.active >= 0 ? lyrics.lines[lyrics.active]?.text : null;
  const pct = duration > 0 ? Math.max(0, Math.min(100, (liveTime / duration) * 100)) : 0;
  const ambientRgb = palette ? palette.rgb.join(" ") : "170 204 60";

  if (!track) {
    return (
      <div className="grid h-dvh place-items-center bg-backdrop p-4 text-center">
        <p className="label-mono">Kein Titel geladen</p>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-dvh flex-col justify-between overflow-hidden bg-backdrop p-3.5 text-foreground"
      style={{
        backgroundImage: `radial-gradient(circle at 20% 10%, rgb(${ambientRgb} / 0.38), transparent 72%)`,
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {track.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.cover}
            alt=""
            className="h-14 w-14 shrink-0 rounded-[var(--radius-art)] object-cover shadow-[0_8px_22px_rgb(0_0_0/0.55)]"
          />
        ) : (
          <CoverPlaceholder className="h-14 w-14 shrink-0 rounded-[var(--radius-art)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-[15px] font-extrabold tracking-tight">{track.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted">{trackArtistLabel(track)}</p>
        </div>
        <LikeButton key={track.id} track={track} />
      </div>

      {activeLine && (
        <p className="font-display my-1.5 line-clamp-2 text-center text-sm font-bold leading-snug tracking-tight text-foreground/95">
          {activeLine}
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-center gap-3">
          <button type="button" onClick={prev} aria-label="Vorheriger Titel" className="action-icon h-9 w-9 text-foreground">
            <PrevIcon width={20} height={20} />
          </button>
          <button type="button" onClick={toggle} aria-label={isPlaying ? "Pause" : "Abspielen"} className="play-fab h-11 w-11">
            {isBuffering ? (
              <SpinnerIcon width={20} height={20} className="animate-spin" />
            ) : isPlaying ? (
              <PauseIcon width={20} height={20} />
            ) : (
              <PlayIcon width={20} height={20} />
            )}
          </button>
          <button type="button" onClick={next} aria-label="Nächster Titel" className="action-icon h-9 w-9 text-foreground">
            <NextIcon width={20} height={20} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-muted">{formatTime(liveTime)}</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
            <div className="h-full bg-accent-soft transition-[width] duration-150" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-muted">{formatTime(duration || 0)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Floating Desktop Mini-Player button powered by Chromium's Document
 * Picture-in-Picture API. Renders nothing on browsers without the API.
 */
export default function PictureInPictureButton({ className = "" }: { className?: string }) {
  const supported = useSyncExternalStore(subscribeNever, isSupportedClient, isSupportedServer);
  const hasTrack = usePlayerStore((s) => s.index >= 0);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  useEffect(() => {
    if (!pipWindow) return;
    const onClose = () => {
      setPipWindow(null);
      setPipContainer(null);
    };
    pipWindow.addEventListener("pagehide", onClose);
    return () => {
      pipWindow.removeEventListener("pagehide", onClose);
    };
  }, [pipWindow]);

  useEffect(() => {
    return () => {
      pipWindow?.close();
    };
  }, [pipWindow]);

  if (!supported) return null;

  async function togglePip() {
    if (pipWindow && !pipWindow.closed) {
      pipWindow.close();
      setPipWindow(null);
      setPipContainer(null);
      return;
    }
    const api = (window as WindowWithDocumentPiP).documentPictureInPicture;
    if (!api) return;
    try {
      const win = await api.requestWindow({ width: 340, height: 220 });
      win.document.title = "LoggeRythm Mini-Player";
      copyStylesToPip(win.document);
      const root = win.document.createElement("div");
      win.document.body.appendChild(root);
      setPipWindow(win);
      setPipContainer(root);
    } catch (cause) {
      toast.error(
        `Mini-Player konnte nicht geöffnet werden: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  const active = Boolean(pipWindow && !pipWindow.closed);

  return (
    <>
      <button
        type="button"
        disabled={!hasTrack && !active}
        onClick={() => void togglePip()}
        aria-label={active ? "Mini-Player schließen" : "Mini-Player abdocken"}
        aria-pressed={active}
        title={active ? "Mini-Player schließen" : "Mini-Player (Immer im Vordergrund)"}
        className={`action-icon relative h-9 w-9 ${active ? "text-accent" : ""} ${className}`}
      >
        <PipIcon width={17} height={17} aria-hidden="true" />
        {active && (
          <span
            aria-hidden="true"
            className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent-soft"
          />
        )}
      </button>
      {pipContainer && createPortal(<PipMiniDeck />, pipContainer)}
    </>
  );
}
