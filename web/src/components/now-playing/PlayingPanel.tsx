"use client";

import { usePlayerStore } from "@/store/player";
import { useBassGlow } from "@/hooks/useBassGlow";
import type { CoverPalette } from "@/hooks/useCoverColors";
import { hiResCover } from "@/lib/cover";
import type { Track } from "@/types";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import LikeButton from "@/components/LikeButton";
import Visualizer from "@/components/Visualizer";
import { SeekBar, TransportRow, VolumeRow } from "./Controls";

/**
 * The "Jetzt läuft" centerpiece: bass-reactive album art with a gradient frame,
 * track meta and the full transport stack, over a cover-tinted ambient panel.
 *
 * Responsive behaviour: on md+ it renders as a glass panel with its own
 * blurred-cover backdrop; on phones it goes full-bleed (the fullscreen shell
 * already provides the ambient backdrop) and the content column scrolls when
 * the viewport is too short (e.g. landscape).
 */
export default function PlayingPanel({
  track,
  palette,
  onClose,
}: {
  track: Track;
  palette: CoverPalette | null;
  onClose: () => void;
}) {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
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
        className="relative min-h-0 flex-1 will-change-[box-shadow] md:rounded-[2.25rem] md:border md:border-white/10 md:bg-white/[0.04] md:backdrop-blur-2xl"
      >
        {/* Panel-local backdrop, desktop only — the shell's ambient backdrop
            already covers the full-bleed mobile layout. */}
        {track.cover && (
          <div className="absolute inset-0 hidden overflow-hidden md:block md:rounded-[2.25rem]">
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

        <div
          data-np-scroll
          className="relative z-10 flex h-full min-h-0 flex-col items-center gap-3 overflow-y-auto overscroll-contain no-scrollbar p-2 pb-16 md:gap-5 md:p-7 md:pb-24 md:[@media(min-height:600px)]:overflow-visible"
        >
          {/* Album centerpiece with a bass-reactive aura + gradient frame */}
          <div className="relative grid w-full min-h-28 flex-1 place-items-center">
            <div
              aria-hidden
              className="absolute aspect-square w-[min(52vw,30vh)] rounded-full blur-[90px]"
              style={{ backgroundColor: auraBg }}
            />
            <div
              ref={albumRef}
              className="relative aspect-square h-full max-h-[min(46vh,20rem)] max-w-full rounded-[1.75rem] will-change-transform md:max-h-[min(42vh,15.5rem)]"
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

            <SeekBar />
            <TransportRow />
            <VolumeRow />
          </div>
        </div>

        {/* Audio-reactive visualizer — pinned flush to the panel's bottom edge,
            matching its corner radius so it reaches the box on every side. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 overflow-hidden md:rounded-b-[2.25rem]"
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
