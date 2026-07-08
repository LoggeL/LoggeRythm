"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import type { Track } from "@/types";
import { useMe } from "@/hooks/useAuth";
import { useLikedIds, useToggleLike } from "@/hooks/useLibrary";
import { HeartIcon } from "@/components/icons";

// Eq-bar sparks of the like burst: irregular angles + alternating brand
// colors so the burst reads as a sound impulse, not uniform confetti.
const BURST_BARS = [
  { angle: 0, color: "var(--accent)" },
  { angle: 55, color: "var(--grad-pink-from)" },
  { angle: 120, color: "var(--accent-soft)" },
  { angle: 180, color: "var(--grad-pink-from)" },
  { angle: 240, color: "var(--accent)" },
  { angle: 300, color: "var(--accent-soft)" },
];

export default function LikeButton({ track }: { track: Track }) {
  const router = useRouter();
  const { data: me } = useMe();
  const likedIds = useLikedIds(!!me);
  const toggleLike = useToggleLike();
  // Gradient fill for the liked heart — unique id per instance because the
  // button renders many times on one page (rows, player bar, now playing).
  const gradId = useId();

  const liked = likedIds.has(String(track.id));

  // Drives the one-shot "beat drop" burst; cleared after the animation ran.
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    if (!burst) return;
    const t = window.setTimeout(() => setBurst(false), 900);
    return () => window.clearTimeout(t);
  }, [burst]);

  function handle() {
    if (!me) {
      router.push("/login");
      return;
    }
    setBurst(!liked); // celebrate likes only, not un-likes
    toggleLike.mutate({ track, liked });
  }

  return (
    <button
      type="button"
      onClick={handle}
      aria-label={liked ? "Like entfernen" : "Liken"}
      title={liked ? "Like entfernen" : "Liken"}
      className={`relative p-1 rounded-full hover:bg-panel-hover transition ${
        liked ? "text-accent" : "text-muted hover:text-foreground"
      }`}
    >
      {burst && (
        <span aria-hidden className="pointer-events-none absolute inset-0">
          <span className="like-ring" />
          <span className="like-ring like-ring-2" />
          {BURST_BARS.map((b, i) => (
            <span
              key={b.angle}
              className="like-bar"
              style={
                {
                  "--burst-angle": `${b.angle}deg`,
                  background: b.color,
                  animationDelay: `${0.05 + (i % 3) * 0.04}s`,
                } as CSSProperties
              }
            />
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
