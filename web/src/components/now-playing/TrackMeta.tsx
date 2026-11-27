"use client";

import type { Track } from "@/types";
import { trackArtistLabel } from "@/lib/trackArtists";
import {
  formatTransitionRemaining,
  transitionKindLabel,
  type TransitionDisplayState,
} from "@/components/player/transitionDisplay";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import LikeButton from "@/components/LikeButton";
import TrackMenu from "@/components/TrackMenu";
import Cover from "@/components/ui/Cover";

/**
 * Title and artist of the playing track. `display` is the large, centred
 * heading under the artwork; `row` is the compact line above the transport
 * (optionally with a thumbnail when the artwork itself is not on screen).
 */
export function TrackHeading({
  track,
  onNavigate,
  variant,
  thumbnail = false,
  transitionDisplay,
}: {
  track: Track;
  onNavigate: () => void;
  variant: "display" | "row";
  thumbnail?: boolean;
  transitionDisplay?: TransitionDisplayState;
}) {
  const showDual = transitionDisplay !== undefined && transitionDisplay.phase !== "idle";

  if (variant === "display") {
    if (showDual) {
      const label = transitionKindLabel(transitionDisplay.kind);
      const remaining =
        transitionDisplay.phase === "active"
          ? formatTransitionRemaining(transitionDisplay.remainingSec)
          : null;
      return (
        <div
          data-heading-transition={transitionDisplay.phase}
          className="mx-auto w-full max-w-2xl rounded-2xl border border-white/14 bg-[#0f0e11]/78 px-6 py-3.5 shadow-[0_16px_42px_rgb(0_0_0/0.52)] backdrop-blur-xl"
        >
          <div
            data-transition-status=""
            className="track-transition-status mb-2.5 flex items-center justify-center gap-2"
          >
            <span aria-hidden="true" className="track-transition-dot h-1.5 w-1.5 shrink-0 rounded-full bg-accent-soft" />
            <span className="label-mono text-[10px] font-semibold text-accent">{label}</span>
            <span aria-hidden="true" className="h-[3px] w-24 overflow-hidden rounded-full bg-white/15">
              <span className="track-transition-meter-fill block h-full w-full rounded-full bg-accent-soft" />
            </span>
            {remaining && (
              <span className="font-mono text-[10.5px] tabular-nums text-foreground/82">
                {remaining}
              </span>
            )}
          </div>

          <div className="flex items-center justify-center gap-4">
            <div
              data-transition-track="outgoing"
              className="track-transition-outgoing-meta min-w-0 flex-1 overflow-hidden text-right"
            >
              <p className="font-display line-clamp-1 text-lg font-bold tracking-tight text-foreground [text-shadow:0_2px_12px_rgb(0_0_0/0.82)] xl:text-xl">
                {transitionDisplay.outgoing.title}
              </p>
              <p className="mt-0.5 truncate text-sm text-foreground/78 [text-shadow:0_1px_10px_rgb(0_0_0/0.8)]">
                {trackArtistLabel(transitionDisplay.outgoing)}
              </p>
            </div>

            <span
              aria-hidden="true"
              data-transition-bridge=""
              className="track-transition-bridge shrink-0 font-mono text-base font-bold text-accent"
            >
              →
            </span>

            <div
              data-transition-track="incoming"
              className="track-transition-incoming-meta min-w-0 flex-1 text-left"
            >
              <TrackTitle
                track={transitionDisplay.incoming}
                onNavigate={onNavigate}
                className="font-display line-clamp-2 text-[clamp(1.25rem,2.1vw,2rem)] font-extrabold leading-[1.06] tracking-[-0.03em] text-foreground [text-shadow:0_2px_14px_rgb(0_0_0/0.82)] hover:underline"
              />
              <ArtistLinks
                track={transitionDisplay.incoming}
                onNavigate={onNavigate}
                className="mt-1 block truncate text-sm text-foreground/82 [text-shadow:0_1px_10px_rgb(0_0_0/0.8)] xl:text-base"
                linkClassName="hover:text-foreground hover:underline"
              />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto w-fit max-w-full rounded-2xl border border-white/12 bg-[#0f0e11]/72 px-6 py-3.5 text-center shadow-[0_16px_42px_rgb(0_0_0/0.48)] backdrop-blur-xl">
        <TrackTitle
          track={track}
          onNavigate={onNavigate}
          className="font-display line-clamp-2 text-[clamp(2rem,3.4vw,3.5rem)] font-extrabold leading-[1.02] tracking-[-0.04em] text-foreground [text-shadow:0_2px_14px_rgb(0_0_0/0.82)] hover:underline"
        />
        <ArtistLinks
          track={track}
          onNavigate={onNavigate}
          className="mt-2 block truncate text-lg text-foreground/82 [text-shadow:0_1px_10px_rgb(0_0_0/0.8)] xl:text-xl"
          linkClassName="hover:text-foreground hover:underline"
        />
      </div>
    );
  }

  if (showDual) {
    const label = transitionKindLabel(transitionDisplay.kind);
    return (
      <div data-heading-transition={transitionDisplay.phase} className="flex items-center gap-2.5">
        {thumbnail && (
          <div className="relative flex shrink-0 items-center">
            <span
              data-transition-cover="outgoing"
              className="track-transition-outgoing-cover-slot track-transition-mini-outgoing block shrink-0 overflow-hidden rounded-[var(--radius-art)]"
            >
              <span className="track-transition-outgoing-cover block overflow-hidden rounded-[var(--radius-art)] ring-1 ring-white/14">
                <Cover src={transitionDisplay.outgoing.cover} className="h-10 w-10 rounded-[var(--radius-art)]" eager />
              </span>
            </span>
            <span
              data-transition-cover="incoming"
              className={`track-transition-incoming-cover relative z-10 block shrink-0 overflow-hidden rounded-[var(--radius-art)] ring-2 ring-[#0f0e11] transition-[margin,width,height] duration-300 ease-out motion-reduce:transition-none ${
                transitionDisplay.phase === "exiting" ? "ml-0 h-12 w-12" : "-ml-3 h-11 w-11"
              }`}
            >
              <Cover src={transitionDisplay.incoming.cover} className="h-full w-full rounded-[var(--radius-art)]" eager />
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div
            data-transition-status=""
            className="track-transition-status mb-0.5 flex items-center gap-1.5"
          >
            <span aria-hidden="true" className="track-transition-dot h-1.5 w-1.5 shrink-0 rounded-full bg-accent-soft" />
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-accent">
              {label}
            </span>
            <span aria-hidden="true" className="h-[2.5px] max-w-24 flex-1 overflow-hidden rounded-full bg-white/16">
              <span className="track-transition-meter-fill block h-full w-full rounded-full bg-accent-soft" />
            </span>
          </div>
          <div
            data-transition-track="outgoing"
            className="track-transition-outgoing-meta flex min-w-0 items-center gap-1 overflow-hidden"
          >
            <span className="font-display truncate text-xs font-semibold text-foreground/80 [text-shadow:0_1px_8px_rgb(0_0_0/0.8)]">
              {transitionDisplay.outgoing.title}
            </span>
            <span aria-hidden="true" className="shrink-0 font-mono text-[10px] text-accent">
              →
            </span>
          </div>
          <div data-transition-track="incoming" className="track-transition-incoming-meta min-w-0">
            <TrackTitle
              track={transitionDisplay.incoming}
              onNavigate={onNavigate}
              className="font-display block truncate text-lg font-bold leading-tight tracking-tight text-foreground [text-shadow:0_1px_8px_rgb(0_0_0/0.8)] hover:underline"
            />
            <ArtistLinks
              track={transitionDisplay.incoming}
              onNavigate={onNavigate}
              className="block truncate text-xs text-foreground/80 [text-shadow:0_1px_8px_rgb(0_0_0/0.75)]"
              linkClassName="hover:text-foreground hover:underline"
            />
          </div>
        </div>
        <LikeButton key={transitionDisplay.incoming.id} track={transitionDisplay.incoming} />
        <TrackMenu track={transitionDisplay.incoming} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      {thumbnail && <Cover src={track.cover} className="h-12 w-12 rounded-[var(--radius-art)]" eager />}
      <div className="min-w-0 flex-1">
        <TrackTitle
          track={track}
          onNavigate={onNavigate}
          className="font-display block truncate text-xl font-bold tracking-tight text-foreground [text-shadow:0_1px_8px_rgb(0_0_0/0.8)] hover:underline"
        />
        <ArtistLinks
          track={track}
          onNavigate={onNavigate}
          className="block truncate text-sm text-foreground/80 [text-shadow:0_1px_8px_rgb(0_0_0/0.75)]"
          linkClassName="hover:text-foreground hover:underline"
        />
      </div>
      <LikeButton key={track.id} track={track} />
      <TrackMenu track={track} />
    </div>
  );
}
