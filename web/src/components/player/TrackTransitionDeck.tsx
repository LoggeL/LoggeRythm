"use client";

import Link from "next/link";
import { useRef, type CSSProperties, type ReactNode } from "react";
import type { Track } from "@/types";
import { NAV_FORWARD } from "@/lib/morph";
import { trackArtistLabel } from "@/lib/trackArtists";
import ArtistLinks from "@/components/ArtistLinks";
import CacheMarker from "@/components/CacheMarker";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import EqualizerBars from "@/components/EqualizerBars";
import LikeButton from "@/components/LikeButton";
import TrackContext from "@/components/TrackContext";
import { ExpandIcon } from "@/components/icons";
import {
  formatTransitionRemaining,
  transitionKindLabel,
  type ActiveTransitionDisplay,
  type ExitingTransitionDisplay,
} from "./transitionDisplay";
import { useLiveTransitionProgress } from "./useTrackTransition";

export type VisibleTransitionDisplay = ActiveTransitionDisplay | ExitingTransitionDisplay;

function DeckCover({ track, className }: { track: Track; className: string }) {
  return track.cover ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={track.cover} alt="" className={`object-cover ${className}`} />
  ) : (
    <CoverPlaceholder className={className} />
  );
}

/**
 * Desktop PlayerBar live transition view: keeps BOTH outgoing and incoming
 * covers & titles clearly visible throughout the entire overlap, with a live
 * 60fps progress meter. Only once the transition completes (`phase === "exiting"`)
 * does the outgoing track smoothly slide/fade out.
 */
export function DesktopTransitionDeck({
  display,
  playing,
  onOpenNowPlaying,
  qualityBadge,
}: {
  display: VisibleTransitionDisplay;
  playing: boolean;
  onOpenNowPlaying: () => void;
  qualityBadge?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLiveTransitionProgress(rootRef, display);

  const progress = display.phase === "active" ? display.progress : 1;
  const label = transitionKindLabel(display.kind);
  const remaining =
    display.phase === "active" ? formatTransitionRemaining(display.remainingSec) : null;

  return (
    <div
      ref={rootRef}
      data-track-transition={display.phase}
      data-transition-kind={display.kind}
      data-transition-id={display.id}
      style={{ "--transition-p": progress.toFixed(4) } as CSSProperties}
      className="track-transition-deck flex min-w-0 items-center gap-3"
    >
      <TrackContext track={display.incoming} className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          onClick={onOpenNowPlaying}
          aria-label={`Übergang von ${display.outgoing.title} zu ${display.incoming.title}: Jetzt läuft öffnen`}
          title="Jetzt läuft öffnen (F)"
          className="group/cover relative flex shrink-0 items-center rounded-[var(--radius-art)] text-left"
        >
          <span
            data-transition-cover="outgoing"
            className="track-transition-outgoing-cover-slot block shrink-0 overflow-hidden rounded-[var(--radius-art)]"
          >
            <span className="track-transition-outgoing-cover relative block overflow-hidden rounded-[var(--radius-art)] ring-1 ring-white/12 shadow-[0_6px_16px_rgb(0_0_0/0.5)]">
              <DeckCover
                track={display.outgoing}
                className="h-12 w-12 xl:h-[52px] xl:w-[52px]"
              />
            </span>
          </span>

          <span
            aria-hidden="true"
            data-transition-bridge=""
            className="track-transition-bridge mx-1.5 flex shrink-0 items-center gap-0.5"
          >
            <span className="relative h-[2px] w-3.5 overflow-hidden rounded-full bg-white/16 xl:w-4">
              <span className="track-transition-meter-fill block h-full w-full bg-accent-soft" />
            </span>
            <span className="font-mono text-[10px] leading-none text-accent">›</span>
          </span>

          <span
            data-transition-cover="incoming"
            className="track-transition-incoming-cover relative block shrink-0 overflow-hidden rounded-[var(--radius-art)] ring-1 ring-accent/55 shadow-[0_8px_22px_rgb(0_0_0/0.55)]"
          >
            <DeckCover
              track={display.incoming}
              className={
                display.phase === "exiting"
                  ? "h-[60px] w-[60px] transition-[width,height] duration-300 ease-out motion-reduce:transition-none"
                  : "h-[52px] w-[52px] xl:h-[56px] xl:w-[56px] transition-[width,height] duration-300 ease-out motion-reduce:transition-none"
              }
            />
            <span className="absolute inset-0 grid place-items-center bg-black/60 opacity-0 transition group-hover/cover:opacity-100 group-focus-visible/cover:opacity-100">
              <ExpandIcon width={18} height={18} />
            </span>
          </span>
        </button>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <div
            data-transition-status=""
            className="track-transition-status mb-0.5 flex items-center gap-1.5"
          >
            <span aria-hidden="true" className="track-transition-dot h-1.5 w-1.5 shrink-0 rounded-full bg-accent-soft" />
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-accent">
              {label}
            </span>
            <span
              aria-hidden="true"
              className="h-[3px] min-w-8 max-w-24 flex-1 overflow-hidden rounded-full bg-white/14"
            >
              <span className="track-transition-meter-fill block h-full w-full rounded-full bg-accent-soft" />
            </span>
            {remaining && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
                {remaining}
              </span>
            )}
          </div>

          <div
            data-transition-track="outgoing"
            className="track-transition-outgoing-meta flex min-w-0 items-baseline gap-1.5 overflow-hidden"
          >
            <span className="font-display truncate text-[12.5px] font-semibold leading-tight tracking-tight text-foreground">
              {display.outgoing.title}
            </span>
            <span aria-hidden="true" className="shrink-0 text-[11px] text-subtle">
              ·
            </span>
            <span className="truncate text-[11.5px] leading-tight text-muted">
              {trackArtistLabel(display.outgoing)}
            </span>
          </div>

          <div
            data-transition-track="incoming"
            className="track-transition-incoming-meta mt-0.5 flex min-w-0 items-center gap-1.5"
          >
            <EqualizerBars height={11} isPlaying={playing} />
            {display.incoming.album_id ? (
              <Link
                href={`/album/${display.incoming.album_id}`}
                transitionTypes={NAV_FORWARD}
                className="font-display min-w-0 truncate text-[14px] font-bold leading-tight tracking-tight text-foreground hover:underline"
              >
                {display.incoming.title}
              </Link>
            ) : (
              <p className="font-display min-w-0 truncate text-[14px] font-bold leading-tight tracking-tight text-foreground">
                {display.incoming.title}
              </p>
            )}
            <CacheMarker trackId={display.incoming.id} />
            {qualityBadge}
            <span aria-hidden="true" className="hidden shrink-0 text-[11px] text-subtle xl:inline">
              ·
            </span>
            <ArtistLinks
              track={display.incoming}
              className="hidden min-w-0 truncate text-[12px] text-muted xl:inline"
              linkClassName="hover:underline hover:text-foreground"
            />
          </div>
        </div>

        <LikeButton key={display.incoming.id} track={display.incoming} />
      </TrackContext>
    </div>
  );
}

/**
 * Compact mobile MiniPlayer live transition header: pairs outgoing + incoming
 * covers and stacked titles with a hairline transition progress meter inside
 * the existing floating mobile bar.
 */
export function MobileTransitionSummary({
  display,
  onOpenNowPlaying,
}: {
  display: VisibleTransitionDisplay;
  onOpenNowPlaying: () => void;
}) {
  const rootRef = useRef<HTMLButtonElement>(null);
  useLiveTransitionProgress(rootRef, display);

  const progress = display.phase === "active" ? display.progress : 1;

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={onOpenNowPlaying}
      data-track-transition={display.phase}
      data-transition-kind={display.kind}
      data-transition-id={display.id}
      style={{ "--transition-p": progress.toFixed(4) } as CSSProperties}
      aria-label={`Übergang von ${display.outgoing.title} zu ${display.incoming.title}: Jetzt läuft öffnen`}
      className="track-transition-mini flex min-w-0 flex-1 items-center gap-2.5 text-left"
    >
      <span className="relative flex shrink-0 items-center">
        <span
          data-transition-cover="outgoing"
          className="track-transition-outgoing-cover-slot track-transition-mini-outgoing block shrink-0 overflow-hidden rounded-[var(--radius-art)]"
        >
          <span className="track-transition-outgoing-cover block overflow-hidden rounded-[var(--radius-art)] ring-1 ring-white/12">
            <DeckCover track={display.outgoing} className="h-10 w-10" />
          </span>
        </span>
        <span
          data-transition-cover="incoming"
          className={`track-transition-incoming-cover relative z-10 block shrink-0 overflow-hidden rounded-[var(--radius-art)] ring-2 ring-panel shadow-[0_4px_12px_rgb(0_0_0/0.6)] transition-[margin,width,height] duration-300 ease-out motion-reduce:transition-none ${
            display.phase === "exiting" ? "ml-0 h-12 w-12" : "-ml-3 h-11 w-11"
          }`}
        >
          <DeckCover track={display.incoming} className="h-full w-full" />
        </span>
      </span>

      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span
          data-transition-track="outgoing"
          className="track-transition-outgoing-meta flex min-w-0 items-center gap-1 overflow-hidden"
        >
          <span className="font-display truncate text-[11px] font-medium leading-tight text-muted">
            {display.outgoing.title}
          </span>
          <span aria-hidden="true" className="shrink-0 font-mono text-[10px] text-accent">
            →
          </span>
        </span>
        <span
          data-transition-track="incoming"
          className="track-transition-incoming-meta flex min-w-0 items-center gap-1.5"
        >
          <span aria-hidden="true" className="track-transition-dot h-1.5 w-1.5 shrink-0 rounded-full bg-accent-soft" />
          <span className="font-display truncate text-[13.5px] font-bold leading-tight tracking-tight text-foreground">
            {display.incoming.title}
          </span>
        </span>
        <span
          aria-hidden="true"
          data-transition-status=""
          className="track-transition-status mt-1 block h-[2px] w-full max-w-36 overflow-hidden rounded-full bg-white/14"
        >
          <span className="track-transition-meter-fill block h-full w-full rounded-full bg-accent-soft" />
        </span>
      </span>
    </button>
  );
}
