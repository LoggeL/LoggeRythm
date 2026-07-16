"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import type { Track } from "@/types";
import { useMe } from "@/hooks/useAuth";
import {
  useLikedIds,
  useLikePending,
  useToggleLike,
} from "@/hooks/useLibrary";
import { HeartIcon } from "@/components/icons";

// Eq-bar sparks of the like burst: irregular angles, travel, and alternating
// brand colors make the hit read like an audio impulse instead of confetti.
const BURST_BARS = [
  { angle: 0, distance: 28, length: 11, color: "#ffffff" },
  { angle: 28, distance: 22, length: 7, color: "var(--grad-pink-from)" },
  { angle: 58, distance: 32, length: 10, color: "var(--accent)" },
  { angle: 92, distance: 25, length: 8, color: "var(--accent-soft)" },
  { angle: 126, distance: 30, length: 12, color: "var(--grad-pink-from)" },
  { angle: 158, distance: 23, length: 7, color: "#ffffff" },
  { angle: 190, distance: 31, length: 10, color: "var(--accent)" },
  { angle: 222, distance: 25, length: 8, color: "var(--grad-pink-from)" },
  { angle: 252, distance: 29, length: 11, color: "var(--accent-soft)" },
  { angle: 282, distance: 24, length: 7, color: "#ffffff" },
  { angle: 314, distance: 33, length: 10, color: "var(--grad-pink-from)" },
  { angle: 338, distance: 23, length: 8, color: "var(--accent)" },
];

const HEART_PARTICLES = [
  { angle: 18, distance: 36, scale: 0.68, color: "var(--grad-pink-from)" },
  { angle: 74, distance: 33, scale: 0.52, color: "#ffffff" },
  { angle: 142, distance: 38, scale: 0.6, color: "var(--accent-soft)" },
  { angle: 206, distance: 34, scale: 0.5, color: "var(--grad-pink-from)" },
  { angle: 266, distance: 39, scale: 0.64, color: "#ffffff" },
  { angle: 326, distance: 35, scale: 0.54, color: "var(--accent-soft)" },
];

export default function LikeButton({ track }: { track: Track }) {
  const router = useRouter();
  const { data: me } = useMe();
  const likedIds = useLikedIds(!!me);
  const toggleLike = useToggleLike(track.id);
  const trackLikePending = useLikePending(track.id);
  // Gradient fill for the liked heart — unique id per instance because the
  // button renders many times on one page (rows, player bar, now playing).
  const gradId = useId();
  const surfaceTimer = useRef<number | null>(null);
  const activeSurface = useRef<HTMLElement | null>(null);

  const liked = likedIds.has(String(track.id));

  // Drives the one-shot heart burst; the enclosing song surface gets its own
  // synchronized flash via data-like-celebrating below.
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    if (!burst) return;
    const t = window.setTimeout(() => setBurst(false), 1100);
    return () => window.clearTimeout(t);
  }, [burst]);

  useEffect(
    () => () => {
      if (surfaceTimer.current !== null) {
        window.clearTimeout(surfaceTimer.current);
      }
      const surface = activeSurface.current;
      surface?.removeAttribute("data-like-celebrating");
      surface?.style.removeProperty("--like-origin-x");
      surface?.style.removeProperty("--like-origin-y");
      activeSurface.current = null;
      surfaceTimer.current = null;
    },
    [],
  );

  function celebrateSurface(button: HTMLButtonElement) {
    const surface = button.closest<HTMLElement>(".like-celebration-surface");
    if (!surface) {
      throw new Error(
        "LikeButton must be rendered inside a .like-celebration-surface element.",
      );
    }

    if (surfaceTimer.current !== null) {
      window.clearTimeout(surfaceTimer.current);
    }
    const previousSurface = activeSurface.current;
    previousSurface?.removeAttribute("data-like-celebrating");
    previousSurface?.style.removeProperty("--like-origin-x");
    previousSurface?.style.removeProperty("--like-origin-y");

    const surfaceRect = surface.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    surface.style.setProperty(
      "--like-origin-x",
      `${buttonRect.left + buttonRect.width / 2 - surfaceRect.left}px`,
    );
    surface.style.setProperty(
      "--like-origin-y",
      `${buttonRect.top + buttonRect.height / 2 - surfaceRect.top}px`,
    );

    // Flush the removed state before re-adding it so an exceptionally quick
    // unlike/re-like still starts a fresh impact instead of resuming midway.
    void surface.offsetWidth;
    surface.setAttribute("data-like-celebrating", "true");
    activeSurface.current = surface;
    surfaceTimer.current = window.setTimeout(() => {
      surface.removeAttribute("data-like-celebrating");
      surface.style.removeProperty("--like-origin-x");
      surface.style.removeProperty("--like-origin-y");
      if (activeSurface.current === surface) activeSurface.current = null;
      surfaceTimer.current = null;
    }, 1100);
  }

  function handle(event: React.MouseEvent<HTMLButtonElement>) {
    if (!me) {
      router.push("/login");
      return;
    }

    if (!liked) {
      setBurst(true);
      celebrateSurface(event.currentTarget);
    } else {
      setBurst(false);
    }
    toggleLike.mutate({ track, liked });
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={toggleLike.isPending || trackLikePending}
      aria-label="Gefällt mir"
      aria-pressed={liked}
      aria-busy={toggleLike.isPending || trackLikePending}
      title={liked ? "Like entfernen" : "Liken"}
      className={`like-button relative z-10 overflow-visible rounded-full p-1 transition hover:bg-panel-hover disabled:cursor-wait disabled:opacity-70 ${
        liked ? "text-accent" : "text-muted hover:text-foreground"
      } ${burst ? "like-button-bursting" : ""}`}
    >
      {burst && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-visible"
        >
          <span className="like-impact" />
          <span className="like-ring" />
          <span className="like-ring like-ring-2" />
          <span className="like-ring like-ring-3" />
          {BURST_BARS.map((b, i) => (
            <span
              key={b.angle}
              className="like-bar"
              style={
                {
                  "--burst-angle": `${b.angle}deg`,
                  "--burst-distance": `${b.distance}px`,
                  "--burst-length": `${b.length}px`,
                  background: b.color,
                  color: b.color,
                  animationDelay: `${0.025 + (i % 4) * 0.018}s`,
                } as CSSProperties
              }
            />
          ))}
          {HEART_PARTICLES.map((particle, i) => (
            <span
              key={particle.angle}
              className="like-particle"
              style={
                {
                  "--particle-angle": `${particle.angle}deg`,
                  "--particle-distance": `${particle.distance}px`,
                  "--particle-scale": particle.scale,
                  color: particle.color,
                  animationDelay: `${0.08 + (i % 3) * 0.035}s`,
                } as CSSProperties
              }
            >
              ♥
            </span>
          ))}
        </span>
      )}
      <svg width={0} height={0} className="absolute" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--grad-pink-from)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
      </svg>
      <HeartIcon
        filled={liked}
        className={`relative ${burst ? "like-pop" : ""}`}
        {...(liked ? { fill: `url(#${gradId})` } : {})}
      />
    </button>
  );
}
